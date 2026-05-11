// xAI Grok drafting client. xAI offers an OpenAI-compatible API at
// https://api.x.ai/v1. Grok has the most distinct voice of any frontier
// model — irreverent, opinionated, less hedged than the Anthropic/OpenAI cluster.

import OpenAI from 'openai';
import { createLogger } from '@/lib/logger';
import { withLangfuseGeneration } from './observability';

const logger = createLogger('grok');

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) throw new Error('XAI_API_KEY not set');
    client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
      maxRetries: 2,
      timeout: 120_000,
    });
    logger.log('Grok client ready');
  }
  return client;
}

// grok-3 is the current flagship writing model from xAI.
export const DRAFTING_MODEL = 'grok-3';

export interface GrokToolResult<T> {
  parsed: T;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  cost_usd: number;
}

/**
 * Grok-3 pricing (as of the knowledge cutoff):
 *   input  $3.00 / MTok
 *   output $15.00 / MTok
 */
function computeCost(usage: { input_tokens: number; output_tokens: number }): number {
  const IN = 3.0 / 1_000_000;
  const OUT = 15.0 / 1_000_000;
  return usage.input_tokens * IN + usage.output_tokens * OUT;
}

export async function callGrokWithSchema<T>(opts: {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<GrokToolResult<T>> {
  const { systemPrompt, userMessage, temperature = 0.85, maxTokens = 8000 } = opts;

  const stop = logger.time('grok-3');
  try {
    // xAI supports json_object response_format. For strict schema enforcement
    // we embed the JSON structure reminder in the system prompt (same approach
    // as DeepSeek, since Grok doesn't support json_schema strict mode yet).
    const res = await withLangfuseGeneration(
      { name: 'broadside-public.grok', provider: 'grok', model: DRAFTING_MODEL, systemPrompt, userMessage, temperature, maxTokens },
      () => getClient().chat.completions.create({
        model: DRAFTING_MODEL,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
      }),
    );
    stop();

    const content = res.choices[0]?.message?.content ?? '';
    if (!content) {
      throw new Error(`grok returned empty content. finish_reason=${res.choices[0]?.finish_reason}`);
    }

    let parsed: T;
    try {
      parsed = JSON.parse(content) as T;
    } catch (err) {
      throw new Error(`grok returned invalid JSON: ${(err as Error).message.slice(0, 200)}`);
    }

    const usage = {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
    };
    const cost = computeCost(usage);
    logger.log(
      `grok done: in=${usage.input_tokens} out=${usage.output_tokens} cost=$${cost.toFixed(4)}`,
    );

    return { parsed, usage, cost_usd: cost };
  } catch (err) {
    stop();
    logger.logMinimal('grok error:', (err as Error).message);
    throw err;
  }
}
