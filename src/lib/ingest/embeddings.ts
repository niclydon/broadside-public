import { getPool } from '@/lib/db/pool';
import { embedBatch } from '@/lib/llm/local-model-gateway';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ingest/embeddings');

const BATCH_SIZE = 32;
const MAX_INPUT_CHARS = 4000; // qwen3-embed-8b handles up to 32K tokens; truncate conservatively

function truncate(s: string): string {
  return s.length <= MAX_INPUT_CHARS ? s : s.slice(0, MAX_INPUT_CHARS);
}

function formatVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/** Embed every context_item that doesn't yet have a context_embeddings row. */
export async function backfillEmbeddings(opts: {
  onProgress?: (done: number, total: number) => void;
} = {}): Promise<{ embedded: number; failed: number }> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; content: string }>(
    `SELECT ci.id, ci.content
       FROM context_items ci
       LEFT JOIN context_embeddings ce ON ce.context_item_id = ci.id
      WHERE ce.context_item_id IS NULL`,
  );

  if (rows.length === 0) {
    logger.log('no items need embedding');
    return { embedded: 0, failed: 0 };
  }

  logger.log(`embedding ${rows.length} items in batches of ${BATCH_SIZE}`);

  let done = 0;
  let embedded = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((r) => truncate(r.content));

    let result: { vectors: number[][]; model: string } | null = null;
    try {
      result = await embedBatch(texts);
    } catch (err) {
      logger.logMinimal(`batch ${i}: embed failed:`, (err as Error).message);
      failed += batch.length;
      done += batch.length;
      opts.onProgress?.(done, rows.length);
      continue;
    }

    // Insert each vector. We use a single query with UNNEST to cut round-trips.
    const ids = batch.map((r) => r.id);
    const vecStrings = result.vectors.map(formatVector);
    try {
      await pool.query(
        `INSERT INTO context_embeddings (context_item_id, embedding, model)
         SELECT UNNEST($1::uuid[]), UNNEST($2::text[])::halfvec, $3
         ON CONFLICT (context_item_id) DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model`,
        [ids, vecStrings, result.model],
      );
      embedded += batch.length;
    } catch (err) {
      logger.logMinimal(`batch ${i}: insert failed:`, (err as Error).message);
      failed += batch.length;
    }

    done += batch.length;
    opts.onProgress?.(done, rows.length);
  }

  logger.log(`embeddings done: ${embedded} ok, ${failed} failed`);
  return { embedded, failed };
}
