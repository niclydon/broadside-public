import OpenAI from 'openai';
import { createLogger } from '@/lib/logger';

const logger = createLogger('embeddings');

// Qwen3-Embedding-8B native output dimensionality. local model gateway passes through native dims; we keep the
// full 4096-dim representation in pgvector (halfvec(4096) for HNSW indexing via pgvector 0.7+).
export const EMBEDDING_DIMS = 4096;

const FORGE_MODEL = 'qwen3-embed-8b';

let localModelGatewayClient: OpenAI | null = null;

function getLocalModelGatewayClient(): OpenAI | null {
  const apiKey = process.env.LOCAL_MODEL_GATEWAY_API_KEY;
  const baseURL = process.env.LOCAL_MODEL_GATEWAY_BASE_URL;
  if (!apiKey || !baseURL) return null;
  if (!localModelGatewayClient) {
    localModelGatewayClient = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 300_000 });
    logger.log('local model gateway client ready:', baseURL);
  }
  return localModelGatewayClient;
}

/** Result of an embed call: which provider+model ran, plus the vectors. */
export interface EmbedResult {
  vectors: number[][];
  model: string;
  provider: 'local-model-gateway';
}

async function embedViaLocalModelGateway(texts: string[]): Promise<EmbedResult> {
  const client = getLocalModelGatewayClient();
  if (!client) throw new Error('local model gateway client not configured');
  // Explicit encoding_format='float' is critical: OpenAI SDK v4+ defaults to 'base64' for wire
  // efficiency, expecting the server to base64-encode the response. local model gateway ignores this param and
  // always returns raw float arrays — so the SDK's auto-decode path interprets the JSON-stringified
  // floats as base64 and produces garbage (1024-element arrays of zeros). 'float' opts out.
  const res = await client.embeddings.create({
    model: FORGE_MODEL,
    input: texts,
    encoding_format: 'float',
  });
  const vectors = res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  if (vectors.length !== texts.length) {
    throw new Error(`local-model-gateway: expected ${texts.length} vectors, got ${vectors.length}`);
  }
  if (vectors[0].length !== EMBEDDING_DIMS) {
    throw new Error(`local-model-gateway: expected ${EMBEDDING_DIMS}-dim vectors, got ${vectors[0].length}`);
  }
  return { vectors, model: FORGE_MODEL, provider: 'local-model-gateway' };
}

/** Embed one batch via local model gateway. No cloud fallback at 4096 dims — text-embedding-3-large caps at 3072
 * and no parity strategy without quality loss. If local model gateway is unavailable, embedding errors propagate
 * and the next sync's backfill loop drains the unembedded backlog. */
export async function embedBatch(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) return { vectors: [], model: FORGE_MODEL, provider: 'local-model-gateway' };
  const stop = logger.time(`embed(${texts.length})`);
  try {
    const result = await embedViaLocalModelGateway(texts);
    stop();
    return result;
  } catch (localModelGatewayErr) {
    stop();
    logger.logMinimal('local-model-gateway embed error:', (localModelGatewayErr as Error).message);
    throw localModelGatewayErr;
  }
}
