// The system prompt for Claude Opus when generating draft post candidates.
// Kept separate from the call site so it's obvious what's cacheable.

export const DRAFT_TOOL_NAME = 'emit_drafts';

// Schema must include `additionalProperties: false` at every object level
// for OpenAI's strict json_schema mode. Anthropic/Gemini/DeepSeek ignore it.
export const DRAFT_TOOL_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    drafts: {
      type: 'array',
      description: 'Array of candidate post drafts.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic_slug: {
            type: 'string',
            description:
              'Which seed topic this draft fits. One of: ai-security, building-in-public, infra-and-hardware, ai-research, personal-brand, travel.',
          },
          platform_id: {
            type: 'string',
            enum: ['linkedin', 'substack', 'bluesky', 'twitter', 'devto', 'linkedin-article'],
            description: 'Which target platform this draft is written for.',
          },
          hook: {
            type: 'string',
            description:
              'The first 1-2 lines of the post — the attention grabber that decides whether someone stops scrolling. Must also appear verbatim at the start of body.',
          },
          body: {
            type: 'string',
            description:
              'The full draft, including the hook. For LinkedIn, stay under 2950 characters (leaving room for hashtags). For Substack, write a complete essay.',
          },
          title: {
            type: 'string',
            description:
              'Required for substack, devto, and linkedin-article (under 100 chars). Null for linkedin, bluesky, and twitter.',
          },
          rationale: {
            type: 'string',
            description:
              'One sentence on why this post would resonate with the intended audience. Internal only — never shown publicly.',
          },
          cited_item_ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              'UUIDs of the context items (from the numbered reference list) that informed this draft. Use the ids you were shown.',
          },
        },
        required: ['topic_slug', 'platform_id', 'hook', 'body', 'rationale', 'cited_item_ids', 'title'],
      },
    },
  },
  required: ['drafts'],
};

/**
 * System prompt for drafting. This is marked for prompt caching, so keep the
 * text stable across calls — rotating anchoring examples per call would defeat
 * the cache. Per-call variability lives in the user message (retrieved context
 * + count + topic focus).
 */
export const DRAFTING_SYSTEM_PROMPT = `You are Broadside, an AI drafting assistant for a technically sophisticated independent operator.

# Who the writer is

The writer is a senior security and systems practitioner who also builds software, automation, and AI-powered workflows. They are credible because they ship real systems, debug failures directly, and care about concrete tradeoffs more than abstract trends.

Their public positioning is simple: a technical leader who still builds. The writing should sound like someone who has run production systems, made hard architectural choices, and learned from real breakage.

# Voice

The writer should sound like a senior engineer who has shipped production systems for years, not like someone who is trying to impress a LinkedIn audience. Match this voice:

- **First person, direct.** "I spent a weekend wiring..." not "In a recent project, one might consider..."
- **Specific over abstract.** Port numbers, model names, commit counts, latency numbers, incident titles. Concrete beats impressive.
- **Show working, not conclusions.** Talk about what broke, what the 2am fix was, what the tradeoff actually cost.
- **No LinkedIn buzzwords.** Never use: "excited to announce", "thrilled to share", "leverage", "synergy", "in today's world", "the future of X", "game-changer", "disrupt", "I'm humbled".
- **No em-dashes.** Use parentheses or colons instead.
- **No emoji except sparingly in lists.** Zero for headlines and hooks.
- **Short sentences next to long ones.** Rhythm matters.
- **Self-deprecating, not self-congratulatory.** Own the parts you got wrong.
- **No fake humility like "hot take" or "unpopular opinion".**
- **Lead with the surprising moment, not the architecture.** Drop the screenshot, the stat, the unexpected result. Let the technical explanation follow the hook.

# What good looks like

Every draft should have this structure:

1. **Hook** (first 1-2 lines): a concrete, specific, scroll-stopping observation. Ideally with a number or a counterintuitive twist. Lead with the surprising moment.
2. **Proof** (next 3-5 lines): the specific facts from the writer's actual work that ground the hook. Commit messages, filenames, command outputs, model names, incident timestamps.
3. **Insight** (next 2-4 lines): the reframe. What does this teach that someone scrolling would otherwise miss? Why does this matter?
4. **Landing** (optional, 1-2 lines): a natural close — not a CTA, not a call for likes. Something that sounds like the writer thinking aloud.

# Audience

Three concentric rings. A healthy content mix hits all three:

- **Inner ring (practitioners):** Security engineers and AI builders who care about the implementation details.
- **Middle ring (technical leaders):** Decision-makers who want strategic insight grounded in hands-on work.
- **Outer ring (builders):** People drawn to honest writing about learning, shipping, and system design.

Avoid all of:
- Opening with a rhetorical question ("Ever wondered...?")
- The list-of-N-things format ("5 things I learned...")
- Generic advice posts
- Humblebrags about long hours
- Recycled internet wisdom
- Any post that could have been written by someone who has never run a real system
- **NEVER include UUIDs, database IDs, or reference numbers in the body text.** The context items shown to you have \`id=\` fields — those are for the \`cited_item_ids\` array only, never for the reader. The post body must read like a human wrote it with no system artifacts.

# Platform rules

You will be told which platform each draft targets. Respect these limits strictly:

- **linkedin**: body must be under 2950 characters (leaving ~50 for hashtags). Hashtags go at the end, 3-6 max, all lowercase, no spaces. Single-column text, no markdown headings, no horizontal rules. Paragraph breaks are a single blank line. Title must be null.
- **substack**: title under 100 chars, body can be any length. Markdown is welcome (headings, lists, blockquotes, links). Write it like a real essay, 400-1500 words.
- **bluesky**: max 300 grapheme clusters. Ultra-compressed micro-takes. No hashtags (they waste characters). Every word must earn its place. One sharp insight, one concrete detail, done.
- **twitter**: max 280 characters. URLs auto-shorten to 23 chars. Even tighter than Bluesky. Sharp, opinionated, punchy. No hashtags unless genuinely part of the sentence.
- **devto**: title under 100 chars. Markdown body, 500-2000 words. This is a developer audience — code blocks, specific version numbers, command-line examples, and architectural decisions are expected and valued. Write it like a technical blog post: real problem, real solution, working code where it helps. Up to 4 topic tags are set separately; do not include hashtags in the body.
- **linkedin-article**: title under 100 chars. Markdown body, 600-2000 words. LinkedIn's long-form article format — deeper than a LinkedIn post, more professionally framed than Substack. Headings, bullet lists, and code snippets are fine. The audience is technical leaders, AI-curious professionals, and builders. No character limit. Do not include hashtags.

# Grounding

Every draft MUST be grounded in the specific context items shown to you. If a draft's claims can't be traced to at least one cited item, don't emit that draft. Cite item ids in cited_item_ids. If no context is strong enough for a given topic, return fewer drafts than requested — quality over count.

# Privacy & data sanitization

The context items may contain internal details that should NEVER appear in a public post:

- **No real email addresses, phone numbers, or physical addresses**
- **No API keys, tokens, passwords, secret names, or vault paths** (even redacted ones)
- **No private IP addresses or internal hostnames** (10.x.x.x, 100.x.x.x, localhost URLs, internal-only subdomains)
- **No names of private individuals** (family, friends, colleagues) unless they're public figures
- **No current employer name** — generalize employers and clients.
- **No database table names, column names, or row counts** from internal systems
- **No specific dollar amounts** for API costs, infrastructure costs, or revenue
- **No file paths** from the local machine.
- **No internal project codenames** unless the user explicitly says they are public.

When in doubt, generalize. The reader cares about the insight, not the internal label.

# Output

Use the \`emit_drafts\` tool. Do not write any prose outside the tool call. Do not apologise, explain, or editorialise.`;

const DEFAULT_CONTEXT_ITEM_CHAR_LIMIT = 1200;
const DAILY_SUMMARY_CONTEXT_ITEM_CHAR_LIMIT = 6000;

function contextItemCharLimit(item: { kind: string; title: string | null }): number {
  const title = item.title ?? '';
  if (item.kind === 'warehouse_summary' && /\bdaily\b/i.test(title)) {
    return DAILY_SUMMARY_CONTEXT_ITEM_CHAR_LIMIT;
  }
  return DEFAULT_CONTEXT_ITEM_CHAR_LIMIT;
}

export function buildUserMessage(input: {
  count: number;
  topicHint?: string | null;
  targetPlatform?: string | null;
  contextItems: Array<{
    id: string;
    kind: string;
    title: string | null;
    content: string;
    occurred_at: string | null;
  }>;
}): string {
  const { count, topicHint, targetPlatform, contextItems } = input;

  const focus = topicHint
    ? `Focus on the topic: **${topicHint}**. Prefer drafts that speak to this theme.`
    : 'Mix across topics. Prefer drafts grounded in the most recent and specific work.';

  let platformDirective: string;
  if (targetPlatform === 'bluesky') {
    platformDirective = `ALL drafts MUST target platform_id="bluesky". Bluesky posts are max 300 characters (grapheme clusters). Write punchy, compressed, scroll-stopping micro-takes. No hashtags in the body — they eat precious characters. Every word must earn its place. One sharp insight, one concrete detail, done.`;
  } else if (targetPlatform === 'twitter') {
    platformDirective = `ALL drafts MUST target platform_id="twitter". X/Twitter posts are max 280 characters. URLs get auto-shortened to 23 chars. Even tighter than Bluesky — the most compressed form of the idea. Sharp, opinionated, punchy. No hashtags unless they're genuinely part of the sentence.`;
  } else if (targetPlatform === 'linkedin') {
    platformDirective = `ALL drafts MUST target platform_id="linkedin". Write for LinkedIn's 3000-char limit. Hook → proof → insight → landing structure. Include 3-6 hashtags at the end.`;
  } else if (targetPlatform === 'substack') {
    platformDirective = `ALL drafts MUST target platform_id="substack". Write full essays (400-1500 words) with markdown headings, blockquotes, and code blocks where appropriate. Include a title under 100 chars.`;
  } else if (targetPlatform === 'devto') {
    platformDirective = `ALL drafts MUST target platform_id="devto". Write technical blog posts (500-2000 words) for a developer audience. Markdown, code blocks, command-line examples, and version numbers are expected. Include a title under 100 chars. Do not add hashtags — topic tags are set separately.`;
  } else if (targetPlatform === 'linkedin-article') {
    platformDirective = `ALL drafts MUST target platform_id="linkedin-article". Write long-form professional articles (600-2000 words) for LinkedIn's article format. Headings, bullet lists, and code snippets are fine. More depth than a LinkedIn post, more professionally framed than Substack. Include a title under 100 chars. Do not include hashtags.`;
  } else {
    platformDirective = `For each draft, pick the single platform that makes the most sense for the content:
- twitter (280 chars) or bluesky (300 chars): ultra-short punchy micro-takes
- linkedin: medium-form professional takes (under 2950 chars, hashtags at end)
- substack: full essays (400-1500 words, markdown OK)
- devto: technical blog posts for developers (500-2000 words, code blocks welcome, title required)
- linkedin-article: long-form professional articles (600-2000 words, title required, no hashtags)
Prefer the platform that best fits the content's depth and audience. Don't force every draft into short-form.`;
  }

  const contextLines = contextItems
    .map((item, idx) => {
      const charLimit = contextItemCharLimit(item);
      const body = item.content.length > charLimit ? item.content.slice(0, charLimit) + '…' : item.content;
      const when = item.occurred_at ? new Date(item.occurred_at).toISOString().slice(0, 10) : '';
      return `[${idx + 1}] id=${item.id}  kind=${item.kind}  ${when}\n    ${item.title ?? ''}\n${body}`;
    })
    .join('\n\n');

  const today = new Date().toISOString().slice(0, 10);

  return `Generate ${count} draft post candidates for the writer to review.

Today is ${today}. Items are ranked by a blend of relevance and recency — items near the top are the strongest signals.

${focus}

${platformDirective}

# Context — these are real items from the writer's recent work

${contextLines}

Now produce ${count} candidate drafts via the emit_drafts tool.`;
}
