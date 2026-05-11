import { getPool } from '@/lib/db/pool';
import { readGitHubRepoFiles, readGitHubCommits, readNeutralRootDocs, type GitHubFileItem, type GitHubCommitItem } from './github';
import {
  readKnowledgeFacts,
  readProactiveInsights,
  readKnowledgeSummaries,
  readBehavioralDNA,
  readCalendarEvents,
  readSilverClaude,
  readSilverGold,
  type WarehouseItem,
} from './shared-warehouse';
import { readHackerNewsStories, readArxivPapers, readRssFeeds, readBlueskySignals, type ExternalItem } from './external';
import { backfillEmbeddings } from './embeddings';
import { scoreTopicRelevance } from './topic-scoring';
import { getSetting } from '@/lib/settings/read';
import { createLogger } from '@/lib/logger';
import type { JobContext } from '@/lib/jobs/runner';

const logger = createLogger('ingest/sync');

async function upsertSource(
  kind: 'github_repo' | 'shared-warehouse_db',
  name: string,
  dbPath: string | null,
): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO context_sources (kind, name, path, last_synced_at)
          VALUES ($1, $2, $3, now())
     ON CONFLICT (kind, name) DO UPDATE SET
       path = EXCLUDED.path,
       last_synced_at = now()
     RETURNING id`,
    [kind, name, dbPath],
  );
  return rows[0].id;
}

async function upsertItem(
  sourceId: string,
  kind: string,
  externalId: string,
  title: string,
  content: string,
  contentHash: string,
  metadata: Record<string, unknown>,
  occurredAt: Date | undefined,
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const pool = getPool();

  const { rows: existing } = await pool.query<{ id: string; content_hash: string }>(
    `SELECT id, content_hash FROM context_items WHERE source_id = $1 AND external_id = $2`,
    [sourceId, externalId],
  );

  if (existing.length > 0) {
    if (existing[0].content_hash === contentHash) return 'unchanged';
    await pool.query(
      `UPDATE context_items
          SET title = $1, content = $2, content_hash = $3, metadata = $4::jsonb,
              occurred_at = $5, ingested_at = now()
        WHERE id = $6`,
      [title, content, contentHash, JSON.stringify(metadata), occurredAt ?? null, existing[0].id],
    );
    // Invalidate the embedding for this item so it gets re-embedded next pass.
    await pool.query(`DELETE FROM context_embeddings WHERE context_item_id = $1`, [existing[0].id]);
    return 'updated';
  }

  await pool.query(
    `INSERT INTO context_items
       (source_id, external_id, kind, title, content, content_hash, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      sourceId,
      externalId,
      kind,
      title,
      content,
      contentHash,
      JSON.stringify(metadata),
      occurredAt ?? null,
    ],
  );
  return 'inserted';
}

export interface SyncResult {
  projects: { inserted: number; updated: number; unchanged: number };
  commits: { inserted: number; updated: number; unchanged: number };
  'shared-warehouse': { inserted: number; updated: number; unchanged: number };
  external: { inserted: number; updated: number; unchanged: number };
  staleDeleted: number;
  embeddings: { embedded: number; failed: number };
  durationMs: number;
}

export async function runFullSync(ctx?: JobContext): Promise<SyncResult> {
  const start = Date.now();

  const maxFileBytes = await getSetting<number>('ingest.max_file_bytes', 204800);
  const gitLimit = await getSetting<number>('ingest.git_commit_limit', 100);
  const sharedWarehouseEnabled = await getSetting<boolean>('ingest.shared-warehouse_enabled', true);
  const sharedWarehouseFactsLimit = await getSetting<number>('ingest.shared-warehouse_facts_limit', 200);
  const sharedWarehouseSummaryLimit = await getSetting<number>('ingest.shared-warehouse_summary_limit', 50);
  const calendarPastDays = await getSetting<number>('ingest.calendar_past_days', 30);
  const calendarFutureDays = await getSetting<number>('ingest.calendar_future_days', 60);
  const silverGoldEnabled = await getSetting<boolean>('ingest.silver_gold_enabled', true);
  const silverGoldPerViewLimit = await getSetting<number>('ingest.silver_gold_per_view_limit', 100);
  const silverGoldDays = await getSetting<number>('ingest.silver_gold_days', 30);
  const externalEnabled = await getSetting<boolean>('ingest.external_enabled', true);
  const externalStoryLimit = await getSetting<number>('ingest.external_story_limit', 40);
  const blacklistReposArr = await getSetting<string[]>('ingest.blacklist_repos', []);
  const blacklistRepos = new Set(blacklistReposArr);

  logger.log('sync starting (github api mode)');
  await ctx?.setProgress(0, 100, 'fetching github repos');

  // -------- GitHub repo files (README, CLAUDE.md, CHANGES.md, docs/) --------
  const { items: projectItems, repoCount } = await readGitHubRepoFiles({
    maxFileBytes,
    blacklistRepos,
  });
  const neutralItems = await readNeutralRootDocs({ maxFileBytes });
  projectItems.push(...neutralItems);

  const projectStats = { inserted: 0, updated: 0, unchanged: 0 };
  await ctx?.setProgress(10, 100, `${projectItems.length} files from ${repoCount} repos + neutral docs`);

  for (const item of projectItems) {
    const sourceId = await upsertSource('github_repo', item.repoName, null);
    const outcome = await upsertItem(
      sourceId,
      item.kind,
      item.externalId,
      item.title,
      item.content,
      item.contentHash,
      item.metadata,
      item.occurredAt,
    );
    projectStats[outcome]++;
  }
  logger.log('github files:', projectStats);
  await ctx?.setProgress(20, 100, 'fetching github commits');

  // -------- GitHub commits --------
  const commitItems: GitHubCommitItem[] = await readGitHubCommits({
    commitLimit: gitLimit,
    blacklistRepos,
  });
  const commitStats = { inserted: 0, updated: 0, unchanged: 0 };
  await ctx?.setProgress(35, 100, `${commitItems.length} commits`);

  for (const item of commitItems) {
    const sourceId = await upsertSource('github_repo', item.repoName, null);
    const outcome = await upsertItem(
      sourceId,
      'git_commit',
      item.externalId,
      item.title,
      item.content,
      item.contentHash,
      item.metadata,
      item.occurredAt,
    );
    commitStats[outcome]++;
  }
  logger.log('github commits:', commitStats);
  await ctx?.setProgress(45, 100, 'reading shared-warehouse db');

  // -------- shared warehouse DB --------
  const warehouseStats = { inserted: 0, updated: 0, unchanged: 0 };

  async function ingestWarehouseBatch(items: WarehouseItem[], sourceName: string) {
    if (items.length === 0) return;
    const sourceId = await upsertSource('shared-warehouse_db', sourceName, null);
    for (const item of items) {
      const outcome = await upsertItem(
        sourceId,
        item.kind,
        item.externalId,
        item.title,
        item.content,
        item.contentHash,
        item.metadata,
        item.occurredAt,
      );
      warehouseStats[outcome]++;
    }
  }

  if (sharedWarehouseEnabled) {
    // Load existing fact external IDs for rotating-window ingestion
    const { rows: existingFactRows } = await getPool().query<{ external_id: string }>(
      `SELECT external_id FROM context_items WHERE kind = 'shared-warehouse_fact'`,
    );
    const existingFactIds = new Set(existingFactRows.map((r: { external_id: string }) => r.external_id));
    logger.logVerbose(`existing shared-warehouse_fact ids for rotation: ${existingFactIds.size}`);

    const facts = await readKnowledgeFacts(sharedWarehouseFactsLimit, existingFactIds);
    await ingestWarehouseBatch(facts, 'knowledge_facts');
    await ctx?.setProgress(40, 100, 'shared-warehouse insights');

    const insights = await readProactiveInsights(200);
    await ingestWarehouseBatch(insights, 'proactive_insights');
    await ctx?.setProgress(48, 100, 'shared-warehouse summaries');

    const summaries = await readKnowledgeSummaries(sharedWarehouseSummaryLimit);
    await ingestWarehouseBatch(summaries, 'knowledge_summaries');
    await ctx?.setProgress(52, 100, 'behavioral dna');

    const behavioral = await readBehavioralDNA(100);
    await ingestWarehouseBatch(behavioral, 'warehouse_behavioral_profiles');
    await ctx?.setProgress(54, 100, 'calendar events');

    const calEvents = await readCalendarEvents(calendarPastDays, calendarFutureDays);
    await ingestWarehouseBatch(calEvents, 'device_calendar_events');
    await ctx?.setProgress(55, 100, 'shared-warehouse silver/gold views');

    const claudeItems = await readSilverClaude();
    await ingestWarehouseBatch(claudeItems, 'warehouse_silver_notes');

    if (silverGoldEnabled) {
      const aiConvLimit = await getSetting<number>('ingest.warehouse_unified_ai_conversations_limit', silverGoldPerViewLimit * 3);
      const commLimit = await getSetting<number>('ingest.warehouse_unified_communication_limit', silverGoldPerViewLimit * 3);
      const viewLimits = new Map<string, number>([
        ['warehouse_unified_ai_conversations', aiConvLimit],
        ['warehouse_unified_communication', commLimit],
      ]);
      const items = await readSilverGold({
        perViewLimit: silverGoldPerViewLimit,
        defaultDays: silverGoldDays,
        viewLimits,
      });
      // Group by view name so each view gets its own context_sources row, preserving
      // the 15-per-source diversity cap in retrieval.
      const grouped = new Map<string, WarehouseItem[]>();
      for (const item of items) {
        const view = item.metadata.warehouse_view as string;
        if (!grouped.has(view)) grouped.set(view, []);
        grouped.get(view)!.push(item);
      }
      for (const [view, batch] of grouped) {
        await ingestWarehouseBatch(batch, view);
      }
    }

  }
  logger.log('shared-warehouse:', warehouseStats);
  await ctx?.setProgress(60, 100, 'external signals');

  // -------- External signals --------
  const externalStats = { inserted: 0, updated: 0, unchanged: 0 };

  async function ingestExternalBatch(items: ExternalItem[], sourceName: string) {
    if (items.length === 0) return;
    const sourceId = await upsertSource('shared-warehouse_db', sourceName, null);
    for (const item of items) {
      const outcome = await upsertItem(
        sourceId, item.kind, item.externalId, item.title,
        item.content, item.contentHash, item.metadata, item.occurredAt,
      );
      externalStats[outcome]++;
    }
  }

  if (externalEnabled) {
    // HackerNews
    const stories = await readHackerNewsStories(externalStoryLimit);
    await ingestExternalBatch(stories, 'hackernews');
    await ctx?.setProgress(62, 100, 'arxiv papers');

    // arXiv
    const arxivEnabled = await getSetting<boolean>('ingest.arxiv_enabled', true);
    if (arxivEnabled) {
      const papers = await readArxivPapers();
      await ingestExternalBatch(papers, 'arxiv');
    }
    await ctx?.setProgress(64, 100, 'rss feeds');

    // RSS feeds
    const rssEnabled = await getSetting<boolean>('ingest.rss_enabled', true);
    if (rssEnabled) {
      const rssItems = await readRssFeeds();
      await ingestExternalBatch(rssItems, 'rss');
    }
    await ctx?.setProgress(66, 100, 'bluesky search');

    // Bluesky search
    const bskyEnabled = await getSetting<boolean>('ingest.bluesky_search_enabled', true);
    if (bskyEnabled) {
      const bskyItems = await readBlueskySignals();
      await ingestExternalBatch(bskyItems, 'bluesky_search');
    }
  }
  logger.log('external:', externalStats);
  await ctx?.setProgress(68, 100, 'cleaning stale items');

  // -------- Stale item cleanup --------
  // Delete items from sources that were not touched during this sync
  // (their last_synced_at is older than when this sync started).
  let staleDeleted = 0;
  try {
    const syncStart = new Date(start);
    const { rowCount } = await getPool().query(
      `DELETE FROM context_items
        WHERE source_id IN (
          SELECT id FROM context_sources WHERE last_synced_at < $1
        )`,
      [syncStart],
    );
    staleDeleted = rowCount ?? 0;
    if (staleDeleted > 0) {
      logger.log(`stale cleanup: deleted ${staleDeleted} items from untouched sources`);
    }
  } catch (err) {
    logger.logMinimal('stale cleanup failed:', (err as Error).message);
  }
  await ctx?.setProgress(70, 100, 'embedding');

  // -------- Embeddings --------
  const embeddings = await backfillEmbeddings({
    onProgress: async (done, total) => {
      const pct = Math.round(70 + (done / Math.max(total, 1)) * 25);
      await ctx?.setProgress(pct, 100, `embedding ${done}/${total}`);
    },
  });

  // -------- Topic relevance scoring --------
  await ctx?.setProgress(96, 100, 'scoring topic relevance');
  const topicScoring = await scoreTopicRelevance();
  logger.log('topic scoring:', topicScoring);

  await ctx?.setProgress(100, 100, 'done');

  const result: SyncResult = {
    projects: projectStats,
    commits: commitStats,
    'shared-warehouse': warehouseStats,
    external: externalStats,
    staleDeleted,
    embeddings,
    durationMs: Date.now() - start,
  };
  logger.log('sync complete:', result);
  return result;
}
