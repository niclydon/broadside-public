import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '@/lib/logger';
import { withLangfuseGeneration } from './observability';

const logger = createLogger('anthropic');

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    client = new Anthropic({ apiKey, maxRetries: 2 });
    logger.log('Anthropic client ready');
  }
  return client;
}

export const DRAFTING_MODEL = 'claude-opus-4-6';

export interface ToolCallResult<T> {
  parsed: T;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  cost_usd: number;
}

/**
 * Claude Opus 4.6 pricing (as of the knowledge cutoff):
 *   input  $15.00 / MTok
 *   cache-write $18.75 / MTok  (1.25x input)
 *   cache-read  $1.50  / MTok  (0.10x input)
 *   output $75.00 / MTok
 */
function computeCost(usage: ToolCallResult<unknown>['usage']): number {
  const IN  = 15   / 1_000_000;
  const CW  = 18.75 / 1_000_000;
  const CR  = 1.50 / 1_000_000;
  const OUT = 75   / 1_000_000;
  return (
    usage.input_tokens * IN +
    usage.cache_creation_input_tokens * CW +
    usage.cache_read_input_tokens * CR +
    usage.output_tokens * OUT
  );
}

/**
 * Call Claude Opus with a fixed (cacheable) system prompt + a single user message,
 * forcing a specific tool call for structured JSON output.
 *
 * Prompt caching is enabled on the system prompt — subsequent calls within the
 * 5-minute cache TTL pay cache-read cost (~10% of normal input) rather than
 * re-tokenising the whole preamble.
 */
export async function callOpusWithTool<T>(opts: {
  systemPrompt: string;
  userMessage: string;
  toolName: string;
  // biome-ignore lint/suspicious/noExplicitAny: JSON Schema is unconstrained
  toolInputSchema: any;
  temperature?: number;
  maxTokens?: number;
}): Promise<ToolCallResult<T>> {
  const {
    systemPrompt,
    userMessage,
    toolName,
    toolInputSchema,
    temperature = 0.7,
    maxTokens = 4000,
  } = opts;

  const stop = logger.time(`opus(${toolName})`);
  try {
    const res = await withLangfuseGeneration(
      { name: `broadside-public.${toolName}`, provider: 'anthropic', model: DRAFTING_MODEL, systemPrompt, userMessage, temperature, maxTokens },
      () => getClient().messages.create({
        model: DRAFTING_MODEL,
        max_tokens: maxTokens,
        temperature,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
        tools: [
          {
            name: toolName,
            description: `Emit structured output for ${toolName}.`,
            input_schema: toolInputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: toolName },
      }),
    );
    stop();

    const toolUse = res.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error(
        `Opus returned no tool_use block. stop_reason=${res.stop_reason}. blocks=${res.content.map((b) => b.type).join(',')}`,
      );
    }

    const usage = {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
    };
    const cost = computeCost(usage);

    logger.log(
      `opus done: in=${usage.input_tokens} out=${usage.output_tokens}` +
        ` cache_w=${usage.cache_creation_input_tokens} cache_r=${usage.cache_read_input_tokens}` +
        ` cost=$${cost.toFixed(4)}`,
    );

    return {
      parsed: toolUse.input as T,
      stop_reason: res.stop_reason ?? '',
      usage,
      cost_usd: cost,
    };
  } catch (err) {
    stop();
    logger.logMinimal('opus error:', (err as Error).message);
    throw err;
  }
}
