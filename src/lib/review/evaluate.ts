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
import { createLogger } from '@/lib/logger';
import { getLangfuse } from '@/lib/tracing/langfuse';

const logger = createLogger('review/evaluate');

export type ReviewProvider = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'grok';

export const REVIEW_TOOL_NAME = 'emit_review';

export const REVIEW_TOOL_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    assessment: {
      type: 'string',
      description: 'Honest 2-4 sentence overall assessment of the current version. Be direct.',
    },
    strengths: {
      type: 'array',
      items: { type: 'string' },
      description: 'What works well in this draft. Be specific — cite phrases or structural choices.',
    },
    weaknesses: {
      type: 'array',
      items: { type: 'string' },
      description: 'What does not work or could be stronger. Be specific and honest.',
    },
    suggestions: {
      type: 'array',
      description: 'Specific, actionable changes you would make. Each should be concrete enough to implement.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          location: {
            type: 'string',
            description: 'Where in the post this applies (e.g., "opening hook", "paragraph 3", "hashtags", "overall structure").',
          },
          current: {
            type: 'string',
            description: 'The current text or pattern you are addressing (quote it if short, summarize if long).',
          },
          suggested: {
            type: 'string',
            description: 'What you would change it to, or what you would do differently.',
          },
          rationale: {
            type: 'string',
            description: 'Why this change improves the post.',
          },
        },
        required: ['location', 'current', 'suggested', 'rationale'],
      },
    },
    score: {
      type: 'number',
      description: 'Overall quality score from 1-10. Be honest: 5 is mediocre, 7 is good, 9+ is exceptional.',
    },
  },
  required: ['assessment', 'strengths', 'weaknesses', 'suggestions', 'score'],
};

export interface ReviewResult {
  assessment: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: Array<{
    location: string;
    current: string;
    suggested: string;
    rationale: string;
  }>;
  score: number;
}

export interface EvaluatePostResult {
  review: ReviewResult;
  provider: ReviewProvider;
  model: string;
  cost_usd: number;
  tokens: { input: number; output: number };
}

// --- Group review types ---

export const GROUP_REVIEW_TOOL_NAME = 'emit_group_review';

export const GROUP_REVIEW_TOOL_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    overall_assessment: {
      type: 'string',
      description: 'Honest 2-4 sentence assessment of the content group as a whole — does the core idea work, is it worth publishing across these platforms?',
    },
    coherence_score: {
      type: 'number',
      description: 'How well the variants work together as a set (1-10). Do they feel like the same idea at different depths, or disconnected posts?',
    },
    per_platform: {
      type: 'array',
      description: 'Review of each platform variant.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          platform: {
            type: 'string',
            description: 'Platform id (linkedin, substack, bluesky, twitter).',
          },
          score: {
            type: 'number',
            description: 'Quality score for this variant (1-10).',
          },
          assessment: {
            type: 'string',
            description: 'Brief assessment of this variant specifically.',
          },
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                location: { type: 'string' },
                current: { type: 'string' },
                suggested: { type: 'string' },
                rationale: { type: 'string' },
              },
              required: ['location', 'current', 'suggested', 'rationale'],
            },
            description: 'Specific suggested changes for this platform variant.',
          },
        },
        required: ['platform', 'score', 'assessment', 'suggestions'],
      },
    },
    cross_platform_suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Suggestions that apply to the group as a whole — e.g., missing platforms, ordering for publication, shared messaging issues.',
    },
  },
  required: ['overall_assessment', 'coherence_score', 'per_platform', 'cross_platform_suggestions'],
};

export interface GroupReviewResult {
  overall_assessment: string;
  coherence_score: number;
  per_platform: Array<{
    platform: string;
    score: number;
    assessment: string;
    suggestions: Array<{
      location: string;
      current: string;
      suggested: string;
      rationale: string;
    }>;
  }>;
  cross_platform_suggestions: string[];
}

export interface EvaluateGroupResult {
  review: GroupReviewResult;
  provider: ReviewProvider;
  model: string;
  cost_usd: number;
  tokens: { input: number; output: number };
}

// --- Shared provider dispatch ---

interface ProviderCallResult<T> {
  parsed: T;
  cost_usd: number;
  model: string;
  tokens: { input: number; output: number };
}

async function callProvider<T>(
  provider: ReviewProvider,
  systemPrompt: string,
  userMessage: string,
  toolName: string,
  // biome-ignore lint/suspicious/noExplicitAny: JSON Schema is unconstrained
  toolSchema: any,
  maxTokens: number = 4000,
  traceId?: string,
): Promise<ProviderCallResult<T>> {
  const lf = getLangfuse();
  const traceName = toolName === REVIEW_TOOL_NAME ? 'review_post' : 'review_group';
  const trace = lf?.trace({
    id: traceId,
    name: traceName,
    input: { provider, systemPromptLength: systemPrompt.length },
    metadata: { provider, toolName },
  });

  const modelMap: Record<ReviewProvider, string> = {
    anthropic: ANTHROPIC_MODEL,
    openai: OPENAI_MODEL,
    gemini: GEMINI_MODEL,
    deepseek: DEEPSEEK_MODEL,
    grok: GROK_MODEL,
  };
  const generation = trace?.generation({
    name: provider,
    model: modelMap[provider],
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  let result: ProviderCallResult<T>;
  try {
    result = await _callProviderInner<T>(provider, systemPrompt, userMessage, toolName, toolSchema, maxTokens);
  } catch (err) {
    generation?.end({ level: 'ERROR', statusMessage: (err as Error).message });
    lf?.flushAsync();
    throw err;
  }

  generation?.end({
    output: result.parsed,
    usage: { input: result.tokens.input, output: result.tokens.output, total: result.tokens.input + result.tokens.output },
    metadata: { cost_usd: result.cost_usd },
  });
  trace?.update({ output: result.parsed, metadata: { cost_usd: result.cost_usd } });
  lf?.flushAsync();
  return result;
}

async function _callProviderInner<T>(
  provider: ReviewProvider,
  systemPrompt: string,
  userMessage: string,
  toolName: string,
  // biome-ignore lint/suspicious/noExplicitAny: JSON Schema is unconstrained
  toolSchema: any,
  maxTokens: number,
): Promise<ProviderCallResult<T>> {
  switch (provider) {
    case 'anthropic': {
      const r = await callOpusWithTool<T>({
        systemPrompt, userMessage, toolName, toolInputSchema: toolSchema,
        temperature: 0.5, maxTokens,
      });
      return { parsed: r.parsed, cost_usd: r.cost_usd, model: ANTHROPIC_MODEL, tokens: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
    }
    case 'openai': {
      const r = await callOpenAIWithSchema<T>({
        systemPrompt, userMessage, schemaName: toolName, schema: toolSchema,
        temperature: 0.5, maxTokens,
      });
      return { parsed: r.parsed, cost_usd: r.cost_usd, model: OPENAI_MODEL, tokens: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
    }
    case 'gemini': {
      const r = await callGeminiWithSchema<T>({
        systemPrompt, userMessage, schema: toolSchema,
        temperature: 0.5, maxTokens,
      });
      return { parsed: r.parsed, cost_usd: r.cost_usd, model: GEMINI_MODEL, tokens: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
    }
    case 'deepseek': {
      const sysPrompt = `${systemPrompt}\n\n# REMINDER: respond with a JSON object exactly matching this shape (no prose around it):\n${JSON.stringify(toolSchema, null, 2)}`;
      const r = await callDeepSeekWithSchema<T>({ systemPrompt: sysPrompt, userMessage, temperature: 0.5, maxTokens });
      return { parsed: r.parsed, cost_usd: r.cost_usd, model: DEEPSEEK_MODEL, tokens: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
    }
    case 'grok': {
      const sysPrompt = `${systemPrompt}\n\n# REMINDER: respond with a JSON object exactly matching this shape (no prose around it):\n${JSON.stringify(toolSchema, null, 2)}`;
      const r = await callGrokWithSchema<T>({ systemPrompt: sysPrompt, userMessage, temperature: 0.5, maxTokens });
      return { parsed: r.parsed, cost_usd: r.cost_usd, model: GROK_MODEL, tokens: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown review provider: ${_exhaustive}`);
    }
  }
}

// --- System prompts ---

const POST_REVIEW_SYSTEM_PROMPT = `You are a senior content editor reviewing a social media post draft written by Studio Owner.

# About the writer's voice and audience

The writer is a technically credible independent operator: someone who builds software, automation, and AI workflows, ships real systems, and writes from hands-on experience instead of abstract trends.

Their voice: first-person, direct, specific (port numbers, model names, commit counts), shows working not conclusions, no LinkedIn buzzwords, no em-dashes, short sentences next to long ones, self-deprecating not self-congratulatory.

Their audience: practitioners and AI builders (inner ring), technical leaders (middle ring), and builders drawn to honest writing about learning and systems (outer ring).

# Your role

You are reviewing an existing draft. Be genuinely honest. Do not be sycophantic. Do not soften your critique to be polite. The goal is to identify what actually works and what does not so the post can improve before publishing.

Evaluate on these dimensions:
- **Hook quality:** Does the opening stop the scroll? Is it specific and surprising?
- **Voice authenticity:** Does this sound like a real technical operator or like generic AI output?
- **Specificity:** Are there enough concrete details (numbers, names, outcomes)?
- **Structure:** Does the post follow hook → proof → insight → landing?
- **Platform fit:** Does the length and tone match the target platform?
- **Audience value:** Would the intended audience actually stop and read this? Would they engage?

# Platform constraints
- LinkedIn: max 3000 chars, no markdown, 3-6 hashtags at end
- Substack: essays, markdown OK, needs a title
- Bluesky: max 300 chars, ultra-compressed, no hashtags
- Twitter/X: max 280 chars, punchy, opinionated

# Output

Use the emit_review tool. Do not write any prose outside the tool call.`;

const GROUP_REVIEW_SYSTEM_PROMPT = `You are a senior content editor reviewing a multi-platform content group written by Studio Owner.

# About the writer's voice and audience

The writer is a technically credible independent operator: someone who builds software, automation, and AI workflows, ships real systems, and writes from hands-on experience instead of abstract trends.

Their voice: first-person, direct, specific (port numbers, model names, commit counts), shows working not conclusions, no LinkedIn buzzwords, no em-dashes, short sentences next to long ones, self-deprecating not self-congratulatory.

Their audience: practitioners and AI builders (inner ring), technical leaders (middle ring), and builders drawn to honest writing about learning and systems (outer ring).

# Your role

You are reviewing a content group: one core idea rendered across multiple platforms at different depths. Each platform variant should feel like the same person talking about the same thing, but adapted to the platform's constraints and audience expectations.

Be genuinely honest. Do not be sycophantic. The goal is to identify what works and what does not so the content can improve before publishing.

# Evaluate the GROUP on:
- **Core idea clarity:** Is there a single, compelling idea that ties the variants together?
- **Cross-platform coherence:** Do the variants feel like a coordinated set, or disconnected posts? Would someone who sees the LinkedIn AND the Bluesky version feel like they got the same signal?
- **Platform adaptation:** Is each variant properly adapted? The Bluesky take should be punchy and compressed, the LinkedIn should have structure, the Substack should be a real essay. Not just truncated/padded versions of each other.
- **Publishing order:** Which should go first? Does the short-form (Bluesky/X) test the angle, then LinkedIn expands, then Substack goes deep?
- **Missing platforms:** Given the idea, is there a platform that should have a variant but doesn't?

# Evaluate each Vshared workspaceNT on:
- **Hook quality, voice authenticity, specificity, structure, platform fit, audience value** (same criteria as single-post review)

# Platform constraints
- LinkedIn: max 3000 chars, no markdown, 3-6 hashtags at end
- Substack: essays, markdown OK, needs a title
- Bluesky: max 300 chars, ultra-compressed, no hashtags
- Twitter/X: max 280 chars, punchy, opinionated

# Output

Use the emit_group_review tool. Do not write any prose outside the tool call.`;

// --- Post-level review ---

export async function evaluatePost(input: {
  body: string;
  title?: string | null;
  platform: string;
  hashtags?: string[];
  provider: ReviewProvider;
  traceId?: string;
}): Promise<EvaluatePostResult> {
  const { body, title, platform, hashtags, provider, traceId } = input;

  const charCount = body.length;
  const hashtagLine = hashtags?.length ? `\nHashtags: ${hashtags.join(' ')}` : '';
  const titleLine = title ? `Title: ${title}\n\n` : '';

  const userMessage = `Review this ${platform} post draft (${charCount} characters):

${titleLine}${body}${hashtagLine}

Target platform: ${platform}
Character count: ${charCount}

Provide an honest assessment via the emit_review tool.`;

  const stop = logger.time(`review(${provider})`);
  try {
    const result = await callProvider<ReviewResult>(
      provider, POST_REVIEW_SYSTEM_PROMPT, userMessage,
      REVIEW_TOOL_NAME, REVIEW_TOOL_SCHEMA, 4000, traceId,
    );
    stop();
    logger.log(`[${provider}] review complete: score=${result.parsed.score} suggestions=${result.parsed.suggestions.length} cost=$${result.cost_usd.toFixed(4)}`);
    return { review: result.parsed, provider, model: result.model, cost_usd: result.cost_usd, tokens: result.tokens };
  } catch (err) {
    stop();
    logger.logMinimal(`[${provider}] review failed:`, (err as Error).message);
    throw err;
  }
}

// --- Group-level review ---

export interface GroupPostInput {
  platform: string;
  title?: string | null;
  body: string;
  hashtags?: string[];
}

export async function evaluateGroup(input: {
  posts: GroupPostInput[];
  provider: ReviewProvider;
  traceId?: string;
}): Promise<EvaluateGroupResult> {
  const { posts, provider, traceId } = input;

  const postBlocks = posts.map((p) => {
    const titleLine = p.title ? `Title: ${p.title}\n` : '';
    const hashtagLine = p.hashtags?.length ? `\nHashtags: ${p.hashtags.join(' ')}` : '';
    return `--- ${p.platform.toUpperCase()} (${p.body.length} chars) ---\n${titleLine}${p.body}${hashtagLine}`;
  }).join('\n\n');

  const userMessage = `Review this content group with ${posts.length} platform variants:

${postBlocks}

Evaluate the group as a whole and each variant individually via the emit_group_review tool.`;

  const stop = logger.time(`group-review(${provider})`);
  try {
    const result = await callProvider<GroupReviewResult>(
      provider, GROUP_REVIEW_SYSTEM_PROMPT, userMessage,
      GROUP_REVIEW_TOOL_NAME, GROUP_REVIEW_TOOL_SCHEMA, 6000, traceId,
    );
    stop();
    logger.log(`[${provider}] group review complete: coherence=${result.parsed.coherence_score} platforms=${result.parsed.per_platform.length} cost=$${result.cost_usd.toFixed(4)}`);
    return { review: result.parsed, provider, model: result.model, cost_usd: result.cost_usd, tokens: result.tokens };
  } catch (err) {
    stop();
    logger.logMinimal(`[${provider}] group review failed:`, (err as Error).message);
    throw err;
  }
}
