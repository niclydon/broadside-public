import { getPool } from '@/lib/db/pool';
import { embedBatch } from '@/lib/llm/local-model-gateway';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ingest/topic-scoring');

interface TopicRow {
  slug: string;
  name: string;
  description: string | null;
}

// Cached topic embeddings — recomputed once per process or when topics change
let cachedTopicEmbeddings: Map<string, number[]> | null = null;
let cacheHash = '';

async function getTopicEmbeddings(): Promise<Map<string, number[]>> {
  const pool = getPool();
  const { rows: topics } = await pool.query<TopicRow>(
    `SELECT slug, name, description FROM topics ORDER BY slug`,
  );

  // Check if topics changed since last cache
  const hash = topics.map((t) => `${t.slug}:${t.description}`).join('|');
  if (cachedTopicEmbeddings && hash === cacheHash) return cachedTopicEmbeddings;

  // Embed each topic: "name: description"
  const texts = topics.map((t) => `${t.name}: ${t.description ?? t.name}`);
  const result = await embedBatch(texts);

  const map = new Map<string, number[]>();
  for (let i = 0; i < topics.length; i++) {
    map.set(topics[i].slug, result.vectors[i]);
  }

  cachedTopicEmbeddings = map;
  cacheHash = hash;
  logger.log(`cached ${map.size} topic embeddings (${result.model})`);
  return map;
}

/** Cosine similarity between two vectors. Assumes L2-normalized (qwen3-embed-8b). */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Score unscored items (external_signal, silver, gold) against all topics using embedding similarity.
 * Writes topic_scores JSONB to each item. Batches DB reads for efficiency.
 */
export async function scoreTopicRelevance(opts?: {
  onProgress?: (done: number, total: number) => Promise<void>;
}): Promise<{ scored: number }> {
  const pool = getPool();

  // Get items needing scoring
  const { rows: unscoredItems } = await pool.query<{ id: string; embedding: string }>(
    `SELECT ci.id, ce.embedding::text
       FROM context_items ci
       JOIN context_embeddings ce ON ce.context_item_id = ci.id
      WHERE ci.kind IN ('external_signal', 'silver', 'gold')
        AND ci.topic_scores IS NULL
      LIMIT 500`,
  );

  if (unscoredItems.length === 0) {
    logger.logVerbose('topic scoring: no unscored items');
    return { scored: 0 };
  }

  const topicEmbeddings = await getTopicEmbeddings();
  const topicSlugs = [...topicEmbeddings.keys()];
  let scored = 0;

  for (let i = 0; i < unscoredItems.length; i++) {
    const item = unscoredItems[i];
    // Parse the pgvector text representation: "[0.1,0.2,...]"
    const embedding = item.embedding
      .replace(/^\[/, '').replace(/\]$/, '')
      .split(',')
      .map(Number);

    const scores: Record<string, number> = {};
    for (const slug of topicSlugs) {
      const topicVec = topicEmbeddings.get(slug)!;
      const sim = cosineSimilarity(embedding, topicVec);
      scores[slug] = Math.round(sim * 1000) / 1000; // 3 decimal places
    }

    await pool.query(
      `UPDATE context_items SET topic_scores = $1::jsonb WHERE id = $2`,
      [JSON.stringify(scores), item.id],
    );
    scored++;

    if (opts?.onProgress && i % 50 === 0) {
      await opts.onProgress(i, unscoredItems.length);
    }
  }

  logger.log(`topic scoring: ${scored} items scored against ${topicSlugs.length} topics`);
  return { scored };
}
