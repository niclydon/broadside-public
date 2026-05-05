import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('drafts/voice');

let cachedSamples: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Build a few-shot voice examples block from the voice_samples table.
 * Picks the longest, most polished samples to give the model the richest
 * signal on the writer's style. Returns a formatted string ready to
 * append to the system prompt.
 *
 * Including this pushes the Anthropic system prompt past the 1024-token
 * caching threshold, activating prompt caching on subsequent calls.
 */
export async function getVoiceSamplesBlock(maxSamples: number = 8): Promise<string> {
  if (cachedSamples && Date.now() - cacheTime < CACHE_TTL) return cachedSamples;

  const pool = getPool();
  try {
    const { rows } = await pool.query<{ body: string; platform_id: string | null; notes: string | null }>(
      `SELECT body, platform_id, notes
         FROM voice_samples
        WHERE char_length(body) > 300
          AND excluded = false
        ORDER BY char_length(body) DESC
        LIMIT $1`,
      [maxSamples],
    );

    if (rows.length === 0) {
      cachedSamples = '';
      cacheTime = Date.now();
      return '';
    }

    const examples = rows.map((r, i) => {
      const truncated = r.body.length > 1500 ? r.body.slice(0, 1500) + '…' : r.body;
      return `### Example ${i + 1} (${r.platform_id ?? 'unknown'}):\n${truncated}`;
    }).join('\n\n');

    const block = `\n\n# Voice examples — real writing from the author

These are actual samples of the writer's voice. Study the rhythm, word choice, sentence length variation, and level of specificity. Your drafts should feel like these, not imitate them word-for-word.

${examples}`;

    cachedSamples = block;
    cacheTime = Date.now();
    logger.logVerbose(`loaded ${rows.length} voice samples (${block.length} chars)`);
    return block;
  } catch (err) {
    logger.logMinimal('voice samples load failed:', (err as Error).message);
    return '';
  }
}
