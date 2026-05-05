import { randomUUID } from 'node:crypto';
import { getPool } from '@/lib/db/pool';
import {
  callOpusWithTool,
  DRAFTING_MODEL as ANTHROPIC_MODEL,
} from '@/lib/llm/anthropic';
import {
  callOpenAIWithSchema,
  DRAFTING_MODEL as OPENAI_MODEL,
} from '@/lib/llm/openai';
import {
  callGeminiWithSchema,
  DRAFTING_MODEL as GEMINI_MODEL,
} from '@/lib/llm/gemini';
import {
  callDeepSeekWithSchema,
  DRAFTING_MODEL as DEEPSEEK_MODEL,
} from '@/lib/llm/deepseek';
import {
  callGrokWithSchema,
  DRAFTING_MODEL as GROK_MODEL,
} from '@/lib/llm/grok';
import {
  DRAFTING_SYSTEM_PROMPT,
  DRAFT_TOOL_NAME,
  DRAFT_TOOL_SCHEMA,
  buildUserMessage,
} from './prompt';
import { retrieveForDraft, type RetrievedItem } from './retrieval';
import { getVoiceSamplesBlock } from './voice';
import { getPerformanceBlock } from './performance';
import { createLogger } from '@/lib/logger';
import { getLangfuse } from '@/lib/tracing/langfuse';
import type { JobContext } from '@/lib/jobs/runner';

const logger = createLogger('drafts/generate');

export type DraftProvider = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'grok';

export const ALL_PROVIDERS: DraftProvider[] = ['anthropic', 'openai', 'gemini', 'deepseek', 'grok'];

export interface GenerateDraftsInput {
  count: number;
  topicHint?: string | null;
  targetPlatform?: string | null;
  mode?: 'on_demand' | 'seed';
  contextLimit?: number;
  provider?: DraftProvider;
}

export interface GenerateDraftsResult {
  generation_id: string;
  provider: DraftProvider;
  model: string;
  candidate_count: number;
  cost_usd: number;
  tokens: {
    input: number;
    output: number;
    cache_write: number;
    cache_read: number;
  };
}

interface EmittedDraft {
  topic_slug: string;
  platform_id: string;
  hook: string;
  body: string;
  title?: string | null;
  rationale: string;
  cited_item_ids: string[];
}

interface EmittedPayload {
  drafts: EmittedDraft[];
}

type ProviderResult = {
  parsed: EmittedPayload;
  cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_write: number;
    cache_read: number;
  };
  model: string;
};

async function callProvider(
  provider: DraftProvider,
  systemPrompt: string,
  userMessage: string,
  traceId?: string,
): Promise<ProviderResult> {
  const lf = getLangfuse();
  const trace = lf?.trace({
    id: traceId,
    name: 'generate_drafts',
    input: { provider, systemPromptLength: systemPrompt.length, userMessageLength: userMessage.length },
    metadata: { provider },
  });

  const modelMap: Record<DraftProvider, string> = {
    anthropic: ANTHROPIC_MODEL,
    openai: OPENAI_MODEL,
    gemini: GEMINI_MODEL,
    deepseek: DEEPSEEK_MODEL,
    grok: GROK_MODEL,
  };
  const model = modelMap[provider];
  const generation = trace?.generation({
    name: provider,
    model,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    modelParameters: { temperature: provider === 'anthropic' ? 0.7 : provider === 'deepseek' ? 0.9 : 0.85 },
  });

  try {
    const result = await _callProviderInner(provider, systemPrompt, userMessage);
    generation?.end({
      output: result.parsed,
      usage: {
        input: result.usage.input_tokens,
        output: result.usage.output_tokens,
        total: result.usage.input_tokens + result.usage.output_tokens,
      },
      metadata: {
        cost_usd: result.cost_usd,
        cache_write: result.usage.cache_write,
        cache_read: result.usage.cache_read,
      },
    });
    trace?.update({ output: { candidate_count: result.parsed.drafts?.length ?? 0 }, metadata: { cost_usd: result.cost_usd } });
    lf?.flushAsync();
    return result;
  } catch (err) {
    generation?.end({ level: 'ERROR', statusMessage: (err as Error).message });
    lf?.flushAsync();
    throw err;
  }
}

async function _callProviderInner(
  provider: DraftProvider,
  systemPrompt: string,
  userMessage: string,
): Promise<ProviderResult> {
  switch (provider) {
    case 'anthropic': {
      const r = await callOpusWithTool<EmittedPayload>({
        systemPrompt,
        userMessage,
        toolName: DRAFT_TOOL_NAME,
        toolInputSchema: DRAFT_TOOL_SCHEMA,
        temperature: 0.7,
        maxTokens: 6000,
      });
      return {
        parsed: r.parsed,
        cost_usd: r.cost_usd,
        model: ANTHROPIC_MODEL,
        usage: {
          input_tokens: r.usage.input_tokens,
          output_tokens: r.usage.output_tokens,
          cache_write: r.usage.cache_creation_input_tokens,
          cache_read: r.usage.cache_read_input_tokens,
        },
      };
    }
    case 'openai': {
      const r = await callOpenAIWithSchema<EmittedPayload>({
        systemPrompt,
        userMessage,
        schemaName: DRAFT_TOOL_NAME,
        schema: DRAFT_TOOL_SCHEMA,
        temperature: 0.8,
        maxTokens: 8000,
      });
      return {
        parsed: r.parsed,
        cost_usd: r.cost_usd,
        model: OPENAI_MODEL,
        usage: {
          input_tokens: r.usage.input_tokens,
          output_tokens: r.usage.output_tokens,
          cache_write: 0,
          cache_read: r.usage.cache_read_tokens,
        },
      };
    }
    case 'gemini': {
      const r = await callGeminiWithSchema<EmittedPayload>({
        systemPrompt,
        userMessage,
        schema: DRAFT_TOOL_SCHEMA,
        temperature: 0.85,
        maxTokens: 8000,
      });
      return {
        parsed: r.parsed,
        cost_usd: r.cost_usd,
        model: GEMINI_MODEL,
        usage: {
          input_tokens: r.usage.input_tokens,
          output_tokens: r.usage.output_tokens,
          cache_write: 0,
          cache_read: 0,
        },
      };
    }
    case 'deepseek': {
      // DeepSeek doesn't support json_schema strict mode — we add an explicit
      // JSON-shape reminder to the system prompt.
      const deepseekSystemPrompt = `${systemPrompt}\n\n# REMINDER: respond with a JSON object exactly matching this shape (no prose around it):\n${JSON.stringify(DRAFT_TOOL_SCHEMA, null, 2)}`;
      const r = await callDeepSeekWithSchema<EmittedPayload>({
        systemPrompt: deepseekSystemPrompt,
        userMessage,
        temperature: 0.9,
        maxTokens: 8000,
      });
      return {
        parsed: r.parsed,
        cost_usd: r.cost_usd,
        model: DEEPSEEK_MODEL,
        usage: {
          input_tokens: r.usage.input_tokens,
          output_tokens: r.usage.output_tokens,
          cache_write: 0,
          cache_read: r.usage.cache_read_tokens,
        },
      };
    }
    case 'grok': {
      const grokSystemPrompt = `${systemPrompt}\n\n# REMINDER: respond with a JSON object exactly matching this shape (no prose around it):\n${JSON.stringify(DRAFT_TOOL_SCHEMA, null, 2)}`;
      const r = await callGrokWithSchema<EmittedPayload>({
        systemPrompt: grokSystemPrompt,
        userMessage,
        temperature: 0.85,
        maxTokens: 8000,
      });
      return {
        parsed: r.parsed,
        cost_usd: r.cost_usd,
        model: GROK_MODEL,
        usage: {
          input_tokens: r.usage.input_tokens,
          output_tokens: r.usage.output_tokens,
          cache_write: 0,
          cache_read: 0,
        },
      };
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}

export async function generateDrafts(
  input: GenerateDraftsInput,
  ctx?: JobContext,
): Promise<GenerateDraftsResult> {
  const count = Math.min(Math.max(input.count ?? 5, 1), 20);
  const contextLimit = input.contextLimit ?? 50;
  const topicHint = input.topicHint ?? null;
  const targetPlatform = input.targetPlatform ?? null;
  const provider = input.provider ?? 'anthropic';

  await ctx?.setProgress(5, 100, `retrieving context (${provider})`);

  const retrieved: RetrievedItem[] = await retrieveForDraft({ topicHint, limit: contextLimit });
  if (retrieved.length === 0) {
    throw new Error('no context available — run Sync Now first');
  }
  logger.log(
    `[${provider}] retrieved ${retrieved.length} context items${topicHint ? ` (topic="${topicHint}")` : ''}${targetPlatform ? ` (platform=${targetPlatform})` : ''}`,
  );

  await ctx?.setProgress(15, 100, `building prompt (${provider})`);

  const userMessage = buildUserMessage({
    count,
    topicHint,
    targetPlatform,
    contextItems: retrieved,
  });

  // Enhance system prompt with voice samples + performance data
  await ctx?.setProgress(18, 100, 'loading voice + performance data');
  const [voiceBlock, perfBlock] = await Promise.all([
    getVoiceSamplesBlock(8),
    getPerformanceBlock(),
  ]);
  const enhancedSystemPrompt = DRAFTING_SYSTEM_PROMPT + voiceBlock + perfBlock;
  logger.logVerbose(
    `system prompt: ${enhancedSystemPrompt.length} chars (base=${DRAFTING_SYSTEM_PROMPT.length} voice=${voiceBlock.length} perf=${perfBlock.length})`,
  );

  // Insert the draft_generations row up-front so failures are recoverable.
  const genId = randomUUID();
  const pool = getPool();
  const tempModel = {
    anthropic: ANTHROPIC_MODEL,
    openai: OPENAI_MODEL,
    gemini: GEMINI_MODEL,
    deepseek: DEEPSEEK_MODEL,
    grok: GROK_MODEL,
  }[provider];
  await pool.query(
    `INSERT INTO draft_generations (id, prompt_summary, model, context_item_ids, status)
     VALUES ($1, $2, $3, $4::uuid[], 'running')`,
    [
      genId,
      topicHint ? `${provider} topic=${topicHint} count=${count}` : `${provider} recent count=${count}`,
      tempModel,
      retrieved.map((r) => r.id),
    ],
  );

  await ctx?.setProgress(25, 100, `calling ${provider}`);

  try {
    const result = await callProvider(provider, enhancedSystemPrompt, userMessage, genId);

    const drafts = Array.isArray(result.parsed?.drafts) ? result.parsed.drafts : [];
    logger.log(`[${provider}] emitted ${drafts.length} drafts`);

    await ctx?.setProgress(80, 100, `persisting ${drafts.length} candidates`);

    for (const d of drafts) {
      await pool.query(
        `INSERT INTO draft_candidates
           (generation_id, topic_slug, hook, body, rationale, cited_item_ids)
         VALUES ($1, $2, $3, $4, $5, $6::uuid[])`,
        [
          genId,
          d.topic_slug,
          d.hook,
          d.body,
          `[${d.platform_id}${d.title ? ` | "${d.title}"` : ''}] ${d.rationale}`,
          Array.isArray(d.cited_item_ids)
            ? d.cited_item_ids.filter((id) => typeof id === 'string' && id.length >= 32)
            : [],
        ],
      );
    }

    await pool.query(
      `UPDATE draft_generations
          SET status = 'done',
              finished_at = now(),
              input_tokens = $1,
              output_tokens = $2,
              cache_read_tokens = $3,
              cost_usd = $4,
              model = $5
        WHERE id = $6`,
      [
        result.usage.input_tokens,
        result.usage.output_tokens,
        result.usage.cache_read,
        result.cost_usd,
        result.model,
        genId,
      ],
    );

    await ctx?.setProgress(100, 100, 'done');

    return {
      generation_id: genId,
      provider,
      model: result.model,
      candidate_count: drafts.length,
      cost_usd: result.cost_usd,
      tokens: {
        input: result.usage.input_tokens,
        output: result.usage.output_tokens,
        cache_write: result.usage.cache_write,
        cache_read: result.usage.cache_read,
      },
    };
  } catch (err) {
    await pool.query(
      `UPDATE draft_generations SET status = 'failed', finished_at = now(), error = $1 WHERE id = $2`,
      [(err as Error).message, genId],
    );
    throw err;
  }
}
