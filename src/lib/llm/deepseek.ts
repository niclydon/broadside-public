// DeepSeek drafting client. DeepSeek offers an OpenAI-compatible API at
// https://api.deepseek.com/v1 with structured output via response_format.

import OpenAI from 'openai';
import { createLogger } from '@/lib/logger';

const logger = createLogger('deepseek');

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');
    client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
      maxRetries: 2,
      timeout: 120_000,
    });
    logger.log('DeepSeek client ready');
  }
  return client;
}

// deepseek-chat = DeepSeek-V3.1 chat model (best general-purpose drafting)
// deepseek-reasoner = V3.1 reasoning model (higher cost, slower, overkill for posts)
export const DRAFTING_MODEL = 'deepseek-chat';

export interface DeepSeekToolResult<T> {
  parsed: T;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
  };
  cost_usd: number;
}

/**
 * DeepSeek-chat pricing (as of the knowledge cutoff):
 *   input  $0.27 / MTok (cache miss) / $0.07 / MTok (cache hit)
 *   output $1.10 / MTok
 */
function computeCost(usage: {
  input_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
}): number {
  const IN = 0.27 / 1_000_000;
  const CR = 0.07 / 1_000_000;
  const OUT = 1.1 / 1_000_000;
  const fresh = Math.max(0, usage.input_tokens - usage.cache_read_tokens);
  return fresh * IN + usage.cache_read_tokens * CR + usage.output_tokens * OUT;
}

export async function callDeepSeekWithSchema<T>(opts: {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<DeepSeekToolResult<T>> {
  const { systemPrompt, userMessage, temperature = 0.9, maxTokens = 8000 } = opts;

  const stop = logger.time('deepseek-chat');
  try {
    // DeepSeek supports the OpenAI-compatible `response_format: { type: 'json_object' }`
    // but NOT json_schema strict mode. We rely on explicit instructions in the
    // system prompt plus JSON parsing to validate shape.
    const res = await getClient().chat.completions.create({
      model: DRAFTING_MODEL,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
    });
    stop();

    const content = res.choices[0]?.message?.content ?? '';
    if (!content) {
      throw new Error(`deepseek returned empty content. finish_reason=${res.choices[0]?.finish_reason}`);
    }

    let parsed: T;
    try {
      parsed = JSON.parse(content) as T;
    } catch (err) {
      throw new Error(`deepseek returned invalid JSON: ${(err as Error).message.slice(0, 200)}`);
    }

    // DeepSeek returns prompt_cache_hit_tokens instead of prompt_tokens_details.cached_tokens.
    const rawUsage = res.usage as unknown as {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    } | undefined;
    const usage = {
      input_tokens: rawUsage?.prompt_tokens ?? 0,
      output_tokens: rawUsage?.completion_tokens ?? 0,
      cache_read_tokens:
        rawUsage?.prompt_cache_hit_tokens ?? rawUsage?.prompt_tokens_details?.cached_tokens ?? 0,
    };
    const cost = computeCost(usage);
    logger.log(
      `deepseek done: in=${usage.input_tokens} out=${usage.output_tokens} cache_r=${usage.cache_read_tokens} cost=$${cost.toFixed(4)}`,
    );

    return { parsed, usage, cost_usd: cost };
  } catch (err) {
    stop();
    logger.logMinimal('deepseek error:', (err as Error).message);
    throw err;
  }
}
