import { query } from '@/lib/db/pool';
import { embedBatch } from '@/lib/llm/local-model-gateway';
import { createLogger } from '@/lib/logger';

const logger = createLogger('drafts/retrieval');

export interface RetrievedItem {
  id: string;
  kind: string;
  title: string | null;
  content: string;
  occurred_at: string | null;
  source_name: string;
}

/** Max items from any single source_name to prevent one repo from dominating. */
const MAX_PER_SOURCE = 15;

/**
 * Pull the most-recent context items with smarter weighting:
 * - Recent commits (last 30 days) get highest priority
 * - CHANGES.md, hand-written CLAUDE.md, and neutral docs are high-value
 * - Items are scored by: recency × kind_weight
 */
export async function retrieveRecent(limit: number): Promise<RetrievedItem[]> {
  // Overfetch to allow diversity-cap filtering downstream
  const fetchLimit = Math.min(limit * 2, 300);
  const { rows } = await query<RetrievedItem>(
    `SELECT ci.id, ci.kind, ci.title, ci.content, ci.occurred_at, cs.name AS source_name
       FROM context_items ci
       JOIN context_sources cs ON cs.id = ci.source_id
      WHERE ci.occurred_at IS NOT NULL
        AND ci.kind IN ('git_commit', 'changes_md', 'claude_md', 'agents_md', 'neutral_doc', 'readme', 'shared-warehouse_fact', 'shared-warehouse_insight', 'shared-warehouse_journal', 'shared-warehouse_summary', 'shared-warehouse_behavioral', 'calendar_event', 'external_signal', 'doc', 'silver', 'gold')
        -- shared warehouse facts older than 90 days get a 0.5x recency penalty below;
        -- no hard cutoff so that high-confidence evergreen facts remain reachable.
      ORDER BY
        -- Composite score: kind importance × recency
        (CASE ci.kind
          WHEN 'changes_md'      THEN 5.0
          WHEN 'claude_md'       THEN 4.0
          WHEN 'neutral_doc'     THEN 4.0
          WHEN 'shared-warehouse_journal'   THEN 3.5  -- reflective essays from shared workspace
          WHEN 'agents_md'       THEN 3.0
          WHEN 'git_commit'      THEN 3.0
          WHEN 'calendar_event'  THEN 3.0  -- upcoming events are high-signal
          WHEN 'shared-warehouse_summary'   THEN 2.5  -- domain overviews
          WHEN 'shared-warehouse_behavioral' THEN 2.5  -- durable writing/personality context
          WHEN 'readme'          THEN 2.5
          WHEN 'external_signal' THEN 2.0  -- industry trending
          WHEN 'gold'            THEN 2.0
          WHEN 'silver'          THEN 1.8
          WHEN 'doc'             THEN 2.0
          WHEN 'shared-warehouse_insight'   THEN 1.5
          WHEN 'shared-warehouse_fact'      THEN 1.0
          ELSE 0.5
        END)
        *
        -- Recency boost: items from last 7 days get 3x, last 30 days get 2x
        (CASE
          WHEN ci.occurred_at >= now() - interval '7 days' THEN 3.0
          WHEN ci.occurred_at >= now() - interval '30 days' THEN 2.0
          WHEN ci.occurred_at >= now() - interval '90 days' THEN 1.0
          ELSE 0.5
        END)
        DESC,
        ci.occurred_at DESC NULLS LAST
      LIMIT $1`,
    [fetchLimit],
  );
  logger.log(`retrieveRecent: ${rows.length} raw items (limit=${limit})`);
  return rows;
}

/**
 * Semantic search via pgvector cosine similarity, with recency boost.
 * Results are re-ranked: 70% semantic similarity + 30% recency score.
 */
export async function retrieveByQuery(queryText: string, limit: number): Promise<RetrievedItem[]> {
  const stop = logger.time(`semantic(${limit})`);
  try {
    const emb = await embedBatch([queryText]);
    const vector = emb.vectors[0];
    const model = emb.model;
    const vectorLiteral = `[${vector.join(',')}]`;

    // Fetch 3x the limit, then re-rank with recency boost
    const fetchLimit = Math.min(limit * 3, 200);
    const { rows } = await query<RetrievedItem & { distance: number }>(
      `SELECT ci.id, ci.kind, ci.title, ci.content, ci.occurred_at, cs.name AS source_name,
              (ce.embedding <=> $1::halfvec) AS distance
         FROM context_items ci
         JOIN context_sources cs ON cs.id = ci.source_id
         JOIN context_embeddings ce ON ce.context_item_id = ci.id
        WHERE ce.model = $2
          -- shared warehouse facts older than 90 days get low recency scores via re-ranking;
          -- no hard cutoff so semantic relevance can still surface evergreen facts.
        ORDER BY ce.embedding <=> $1::halfvec
        LIMIT $3`,
      [vectorLiteral, model, fetchLimit],
    );
    stop();

    // Re-rank: combine semantic score with recency
    const now = Date.now();
    const reranked = rows.map((r) => {
      const semanticScore = 1 - r.distance; // 0..1 where 1 is most similar
      const ageMs = r.occurred_at ? now - new Date(r.occurred_at).getTime() : Infinity;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recencyScore = ageDays < 7 ? 1.0 : ageDays < 30 ? 0.7 : ageDays < 90 ? 0.4 : 0.1;
      const combined = semanticScore * 0.7 + recencyScore * 0.3;
      return { ...r, combined };
    });

    reranked.sort((a, b) => b.combined - a.combined);
    const result = reranked.slice(0, limit);

    logger.log(`retrieveByQuery("${queryText.slice(0, 40)}"): ${result.length} items (model=${model}, reranked)`);
    return result;
  } catch (err) {
    stop();
    logger.logMinimal('semantic retrieve failed, falling back to recent:', (err as Error).message);
    return retrieveRecent(limit);
  }
}

/**
 * Enforce a per-source diversity cap. Items beyond MAX_PER_SOURCE from the
 * same source_name are dropped and backfilled from lower-ranked items.
 */
function applyDiversityCap(items: RetrievedItem[], limit: number): RetrievedItem[] {
  const counts = new Map<string, number>();
  const result: RetrievedItem[] = [];
  const overflow: RetrievedItem[] = [];

  for (const item of items) {
    const n = counts.get(item.source_name) ?? 0;
    if (n < MAX_PER_SOURCE) {
      result.push(item);
      counts.set(item.source_name, n + 1);
    } else {
      overflow.push(item);
    }
  }

  // Backfill from overflow if we haven't hit limit (items from other sources)
  for (const item of overflow) {
    if (result.length >= limit) break;
    result.push(item);
  }

  return result.slice(0, limit);
}

/**
 * Load context item IDs that have been cited in draft_candidates in the
 * last 14 days, so we can deprioritize already-drafted material.
 */
async function loadRecentlyCitedIds(): Promise<Set<string>> {
  try {
    const { rows } = await query<{ item_id: string }>(
      `SELECT DISTINCT unnest(cited_item_ids)::text AS item_id
         FROM draft_candidates
        WHERE created_at >= now() - interval '14 days'
          AND array_length(cited_item_ids, 1) > 0`,
    );
    return new Set(rows.map((r) => r.item_id));
  } catch {
    return new Set();
  }
}

/**
 * Deprioritize items that were recently cited in draft candidates.
 * Moves them to the end of the list rather than removing them entirely.
 */
function applyDraftedDedup(items: RetrievedItem[], citedIds: Set<string>): RetrievedItem[] {
  if (citedIds.size === 0) return items;
  const fresh: RetrievedItem[] = [];
  const stale: RetrievedItem[] = [];
  for (const item of items) {
    if (citedIds.has(item.id)) {
      stale.push(item);
    } else {
      fresh.push(item);
    }
  }
  logger.logVerbose(`drafted-dedup: ${stale.length} recently-cited items deprioritized`);
  return [...fresh, ...stale];
}

/**
 * Load topic slugs for matching topicHint to a known topic.
 */
async function loadTopicSlugs(): Promise<Set<string>> {
  try {
    const { rows } = await query<{ slug: string }>(`SELECT slug FROM topics`);
    return new Set(rows.map((r) => r.slug));
  } catch {
    return new Set();
  }
}

/**
 * Boost external signals by topic relevance score when topic hint matches a known slug.
 * Items with high topic_scores for the matched slug get moved up in the ranking.
 */
async function applyTopicBoost(items: RetrievedItem[], topicSlug: string): Promise<RetrievedItem[]> {
  // Load topic_scores for external_signal items in this batch
  const signalIds = items.filter((i) => i.kind === 'external_signal').map((i) => i.id);
  if (signalIds.length === 0) return items;

  try {
    const { rows } = await query<{ id: string; score: number }>(
      `SELECT id, (topic_scores->>$1)::float AS score
         FROM context_items
        WHERE id = ANY($2::uuid[])
          AND topic_scores IS NOT NULL
          AND (topic_scores->>$1)::float > 0.4`,
      [topicSlug, signalIds],
    );
    const scoreMap = new Map(rows.map((r) => [r.id, r.score]));

    if (scoreMap.size === 0) return items;

    // Sort: items with a topic boost get moved up proportionally
    const boosted = items.map((item, idx) => {
      const topicScore = scoreMap.get(item.id) ?? 0;
      // Boost = position penalty reduction. Higher topic score = more boost.
      const boost = topicScore > 0 ? topicScore * 0.3 : 0;
      return { item, originalRank: idx, boost };
    });

    boosted.sort((a, b) => {
      const aScore = 1 - a.originalRank / items.length + a.boost;
      const bScore = 1 - b.originalRank / items.length + b.boost;
      return bScore - aScore;
    });

    logger.logVerbose(`topic boost (${topicSlug}): ${scoreMap.size} external signals boosted`);
    return boosted.map((b) => b.item);
  } catch (err) {
    logger.logMinimal('topic boost failed:', (err as Error).message);
    return items;
  }
}

/** Given an optional topic hint, pick the right retrieval mode. */
export async function retrieveForDraft(opts: {
  topicHint?: string | null;
  limit: number;
}): Promise<RetrievedItem[]> {
  const [raw, citedIds, topicSlugs] = await Promise.all([
    opts.topicHint && opts.topicHint.trim().length > 0
      ? retrieveByQuery(opts.topicHint, opts.limit)
      : retrieveRecent(opts.limit),
    loadRecentlyCitedIds(),
    loadTopicSlugs(),
  ]);

  // Apply post-processing: dedup recently-cited → topic boost → diversity cap → trim to limit
  const deduped = applyDraftedDedup(raw, citedIds);

  // If topicHint matches a known topic slug, boost relevant external signals
  const hint = opts.topicHint?.trim().toLowerCase().replace(/\s+/g, '-') ?? '';
  const boosted = topicSlugs.has(hint)
    ? await applyTopicBoost(deduped, hint)
    : deduped;

  const diverse = applyDiversityCap(boosted, opts.limit);

  logger.log(`retrieveForDraft: ${raw.length} raw → ${diverse.length} after dedup+${topicSlugs.has(hint) ? 'boost+' : ''}diversity`);
  return diverse;
}
