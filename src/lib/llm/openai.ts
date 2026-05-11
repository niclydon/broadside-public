// OpenAI drafting client (distinct from the embeddings fallback in local-model-gateway.ts).
// Uses response_format: json_schema for structured output, which is the OpenAI
// equivalent of Anthropic tool_use for enforcing a JSON shape.

import OpenAI from 'openai';
import { createLogger } from '@/lib/logger';
import { withLangfuseGeneration } from './observability';

const logger = createLogger('openai');

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set');
    client = new OpenAI({ apiKey, maxRetries: 2, timeout: 90_000 });
    logger.log('OpenAI drafting client ready');
  }
  return client;
}

export const DRAFTING_MODEL = 'gpt-4o';

export interface OpenAIToolResult<T> {
  parsed: T;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
  };
  cost_usd: number;
}

/**
 * GPT-4o pricing (as of the knowledge cutoff):
 *   input  $2.50 / MTok (cache hits $1.25)
 *   output $10.00 / MTok
 */
function computeCost(usage: {
  input_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
}): number {
  const IN = 2.5 / 1_000_000;
  const CR = 1.25 / 1_000_000;
  const OUT = 10 / 1_000_000;
  const fresh = usage.input_tokens - usage.cache_read_tokens;
  return Math.max(0, fresh) * IN + usage.cache_read_tokens * CR + usage.output_tokens * OUT;
}

export async function callOpenAIWithSchema<T>(opts: {
  systemPrompt: string;
  userMessage: string;
  schemaName: string;
  // biome-ignore lint/suspicious/noExplicitAny: JSON Schema is unconstrained
  schema: any;
  temperature?: number;
  maxTokens?: number;
}): Promise<OpenAIToolResult<T>> {
  const {
    systemPrompt,
    userMessage,
    schemaName,
    schema,
    temperature = 0.8,
    maxTokens = 8000,
  } = opts;

  const stop = logger.time(`gpt4o(${schemaName})`);
  try {
    const res = await withLangfuseGeneration(
      { name: `broadside-public.${schemaName}`, provider: 'openai', model: DRAFTING_MODEL, systemPrompt, userMessage, temperature, maxTokens },
      () => getClient().chat.completions.create({
        model: DRAFTING_MODEL,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schemaName,
            schema,
            strict: true,
          },
        },
      }),
    );
    stop();

    const content = res.choices[0]?.message?.content ?? '';
    if (!content) {
      throw new Error(`gpt-4o returned empty content. finish_reason=${res.choices[0]?.finish_reason}`);
    }

    let parsed: T;
    try {
      parsed = JSON.parse(content) as T;
    } catch (err) {
      throw new Error(`gpt-4o returned invalid JSON: ${(err as Error).message}`);
    }

    const usage = {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
      cache_read_tokens: res.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };
    const cost = computeCost(usage);
    logger.log(
      `gpt-4o done: in=${usage.input_tokens} out=${usage.output_tokens} cache_r=${usage.cache_read_tokens} cost=$${cost.toFixed(4)}`,
    );

    return { parsed, usage, cost_usd: cost };
  } catch (err) {
    stop();
    logger.logMinimal('gpt-4o error:', (err as Error).message);
    throw err;
  }
}
