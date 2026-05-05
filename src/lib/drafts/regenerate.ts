import { getPool, query } from '@/lib/db/pool';
import { validateBrandPlatforms } from '@/lib/brand-platform-check';
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
import type { Post } from '@/lib/types';

export type RefreshProvider = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'grok';

const logger = createLogger('drafts/regenerate');

const REGEN_TOOL_NAME = 'emit_regenerated';

const REGEN_TOOL_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          platform_id: {
            type: 'string',
            enum: ['linkedin', 'substack', 'bluesky', 'twitter'],
          },
          body: { type: 'string' },
          title: { type: 'string', description: 'Substack title only; null for others' },
        },
        required: ['platform_id', 'body', 'title'],
      },
    },
  },
  required: ['posts'],
};

export interface RegenerateResult {
  updated_post_ids: string[];
  provider: string;
  cost_usd: number;
}

/**
 * Regenerate short-form posts within a content group, incorporating published
 * URLs from sibling posts as links. The typical flow:
 *   1. Publish Substack essay + LinkedIn post (long-form anchors)
 *   2. Record published URLs on those posts
 *   3. Call this to regenerate Bluesky/Twitter posts with "Read more: [url]" links
 *
 * This overwrites the target posts' body (creating a version snapshot first).
 */
export async function regenerateWithLinks(
  groupId: string,
  targetPlatformIds: string[],
): Promise<RegenerateResult> {
  const pool = getPool();

  // Brand-platform enforcement
  const groupRows = await query<{ brand_id: string | null }>(
    `SELECT brand_id FROM content_groups WHERE id = $1`,
    [groupId],
  );
  const groupBrandId = groupRows.rows[0]?.brand_id;
  if (groupBrandId) {
    await validateBrandPlatforms(groupBrandId, targetPlatformIds);
  }

  // Load all posts in the group
  const { rows: allPosts } = await pool.query<Post>(
    `SELECT * FROM posts WHERE content_group_id = $1 ORDER BY platform_id`,
    [groupId],
  );
  if (allPosts.length === 0) throw new Error('content group has no posts');

  // Identify published siblings with URLs (the "anchors")
  const anchors = allPosts.filter((p) => p.posted_url && p.status === 'posted');
  if (anchors.length === 0) throw new Error('no published posts with URLs in this group — publish the long-form posts first');

  // Identify target posts to regenerate
  const targets = allPosts.filter((p) => targetPlatformIds.includes(p.platform_id));
  if (targets.length === 0) throw new Error('no matching posts for the requested platforms');

  // Build anchor context
  const anchorLines = anchors.map((a) => {
    const preview = a.body.length > 500 ? a.body.slice(0, 500) + '…' : a.body;
    return `${a.platform_id.toUpperCase()} (published): ${a.posted_url}\n${a.title ? `Title: ${a.title}\n` : ''}${preview}`;
  }).join('\n\n');

  // Build source material (longest post body for full context)
  const longestPost = [...allPosts].sort((a, b) => b.body.length - a.body.length)[0];

  const platformRules: Record<string, string> = {
    twitter: 'X/Twitter: max 280 characters. URLs auto-shorten to 23 chars. Include a link to one of the published posts. One sharp insight + the link.',
    bluesky: 'Bluesky: max 300 characters. Include a link to one of the published posts. Punchy teaser that makes someone click through.',
    linkedin: 'LinkedIn: up to 3000 chars. Hook → proof → insight → landing. If linking to a Substack essay, make it a natural CTA at the end. 3-6 hashtags.',
    substack: 'Substack: full essay. If linking to a LinkedIn post, reference it naturally.',
  };

  const targetInstructions = targets
    .map((t) => `- ${platformRules[t.platform_id] ?? t.platform_id}`)
    .join('\n');

  const systemPrompt = `You are regenerating short-form social media posts to promote already-published long-form content by Studio Owner.

# Published posts (these are LIVE — link to them)

${anchorLines}

# Full source material

${longestPost.title ? `Title: ${longestPost.title}\n` : ''}${longestPost.body}

# Your task

Write new versions of the target platform posts that:
1. Tease the core idea with a scroll-stopping hook
2. Include a natural link to one of the published posts above
3. Make the reader want to click through to read the full version
4. Sound like the original author (direct, specific, no LinkedIn buzzwords, no em-dashes)

The link should feel organic, not forced. "I wrote about this in depth:" or "Full breakdown:" or just ending with the URL works better than "Check out my post at [link]!"

NEVER include UUIDs, database IDs, private IPs, API keys, file paths, or internal system names.

Target platforms:
${targetInstructions}`;

  const userMessage = `Regenerate ${targets.length} post(s) incorporating links to the published content. Use the emit_regenerated tool.`;

  const result = await callOpusWithTool<{ posts: Array<{ platform_id: string; body: string; title: string }> }>({
    systemPrompt,
    userMessage,
    toolName: REGEN_TOOL_NAME,
    toolInputSchema: REGEN_TOOL_SCHEMA,
    temperature: 0.6,
    maxTokens: 4000,
  });

  const generated = result.parsed.posts ?? [];
  const updatedIds: string[] = [];

  for (const gen of generated) {
    const target = targets.find((t) => t.platform_id === gen.platform_id);
    if (!target) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Version snapshot of current state
      const { rows: nextVRows } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM post_versions WHERE post_id = $1`,
        [target.id],
      );
      await client.query(
        `INSERT INTO post_versions (post_id, version, title, body, hashtags, edited_by)
         VALUES ($1, $2, $3, $4, $5, 'ai')`,
        [target.id, nextVRows[0].next, target.title, target.body, target.hashtags],
      );

      // Update with regenerated content
      await client.query(
        `UPDATE posts SET body = $1, title = $2 WHERE id = $3`,
        [gen.body, gen.title || null, target.id],
      );

      await client.query('COMMIT');
      updatedIds.push(target.id);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.logMinimal('regenerate failed for', gen.platform_id, (err as Error).message);
    } finally {
      client.release();
    }
  }

  logger.log(`regenerated ${updatedIds.length} posts in group ${groupId} with links from ${anchors.length} anchor(s), cost=$${result.cost_usd.toFixed(4)}`);
  return { updated_post_ids: updatedIds, provider: 'anthropic', cost_usd: result.cost_usd };
}

// ---------------------------------------------------------------------------
// Refresh downstream posts from a source post within the same group
// ---------------------------------------------------------------------------

const REFRESH_TOOL_NAME = 'emit_refreshed';

const REFRESH_TOOL_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          platform_id: {
            type: 'string',
            enum: ['linkedin', 'substack', 'bluesky', 'twitter'],
          },
          body: { type: 'string' },
          title: { type: 'string', description: 'Substack title only; null for others' },
        },
        required: ['platform_id', 'body', 'title'],
      },
    },
  },
  required: ['posts'],
};

export interface RefreshResult {
  updated_post_ids: string[];
  provider: string;
  model: string;
  cost_usd: number;
}

/**
 * Refresh downstream posts by re-deriving them from a source post.
 * Use case: the Substack essay was significantly rewritten, now the LinkedIn,
 * Bluesky, and Twitter posts need to be updated to match.
 *
 * The source post provides the canonical content; target posts get rewritten
 * to be platform-appropriate adaptations of the source. Version history is
 * preserved for all target posts.
 */
export async function refreshFromSource(input: {
  groupId: string;
  sourcePostId: string;
  targetPlatformIds: string[];
  provider: RefreshProvider;
}): Promise<RefreshResult> {
  const { groupId, sourcePostId, targetPlatformIds, provider } = input;
  const pool = getPool();

  // Load all posts in the group
  const { rows: allPosts } = await pool.query<Post>(
    `SELECT * FROM posts WHERE content_group_id = $1 ORDER BY platform_id`,
    [groupId],
  );
  if (allPosts.length === 0) throw new Error('content group has no posts');

  const source = allPosts.find((p) => p.id === sourcePostId);
  if (!source) throw new Error('source post not found in this group');

  const targets = allPosts.filter((p) => targetPlatformIds.includes(p.platform_id) && p.id !== sourcePostId);
  if (targets.length === 0) throw new Error('no target posts to refresh');

  // Include published URLs from any sibling for link context
  const publishedSiblings = allPosts.filter((p) => p.posted_url);
  const linkContext = publishedSiblings.length > 0
    ? `\n\n# Published URLs (include these naturally if the platform variant should link to them)\n${publishedSiblings.map((p) => `- ${capitalize(p.platform_id)}: ${p.posted_url}`).join('\n')}`
    : '';

  const platformRules: Record<string, string> = {
    twitter: 'X/Twitter: max 280 characters. URLs auto-shorten to 23 chars. Ultra-compressed. One sharp insight, one concrete detail. No hashtags unless organic.',
    bluesky: 'Bluesky: max 300 characters. Punchy micro-take. Every word earns its place.',
    linkedin: 'LinkedIn: up to 3000 chars. Hook → proof → insight → landing. 3-6 hashtags at end. Not a summary of the essay — a standalone piece that happens to cover the same territory.',
    substack: 'Substack: full essay (400-1500 words). Markdown. Title under 100 chars.',
  };

  const targetInstructions = targets
    .map((t) => `- ${platformRules[t.platform_id] ?? t.platform_id}`)
    .join('\n');

  const systemPrompt = `You are adapting a source post into platform-specific variants for Studio Owner.

# Source post (${capitalize(source.platform_id)}, ${source.body.length} chars)

${source.title ? `Title: ${source.title}\n\n` : ''}${source.body}
${linkContext}

# Your task

Create new versions of the target platform posts below. Each should:
1. Capture the core idea and key details from the source
2. Be a genuine adaptation for the target platform, not a truncation or summary
3. Sound like the original author (first-person, direct, specific details, no LinkedIn buzzwords, no em-dashes)
4. Respect the platform's character limits and norms
5. Include any relevant published URLs naturally (not forced)

The short-form posts (Bluesky, Twitter) should be scroll-stopping teasers that make someone want to read more. The LinkedIn version should be a standalone post that covers the same ground with its own hook and structure. None of them should read like "here's a summary of my Substack post."

NEVER include UUIDs, database IDs, private IPs, API keys, file paths, or internal system names.

Target platforms:
${targetInstructions}`;

  const userMessage = `Rewrite ${targets.length} platform variant(s) based on the updated source content. Use the ${REFRESH_TOOL_NAME} tool.`;

  const stop = logger.time(`refresh(${provider})`);

  type ParsedResult = { posts: Array<{ platform_id: string; body: string; title: string }> };
  let parsed: ParsedResult;
  let cost_usd: number;
  let model: string;

  try {
    switch (provider) {
      case 'anthropic': {
        const r = await callOpusWithTool<ParsedResult>({
          systemPrompt, userMessage, toolName: REFRESH_TOOL_NAME,
          toolInputSchema: REFRESH_TOOL_SCHEMA, temperature: 0.6, maxTokens: 6000,
        });
        parsed = r.parsed; cost_usd = r.cost_usd; model = ANTHROPIC_MODEL;
        break;
      }
      case 'openai': {
        const r = await callOpenAIWithSchema<ParsedResult>({
          systemPrompt, userMessage, schemaName: REFRESH_TOOL_NAME,
          schema: REFRESH_TOOL_SCHEMA, temperature: 0.6, maxTokens: 6000,
        });
        parsed = r.parsed; cost_usd = r.cost_usd; model = OPENAI_MODEL;
        break;
      }
      case 'gemini': {
        const r = await callGeminiWithSchema<ParsedResult>({
          systemPrompt, userMessage, schema: REFRESH_TOOL_SCHEMA,
          temperature: 0.6, maxTokens: 6000,
        });
        parsed = r.parsed; cost_usd = r.cost_usd; model = GEMINI_MODEL;
        break;
      }
      case 'deepseek': {
        const sysPrompt = `${systemPrompt}\n\n# REMINDER: respond with a JSON object exactly matching this shape (no prose around it):\n${JSON.stringify(REFRESH_TOOL_SCHEMA, null, 2)}`;
        const r = await callDeepSeekWithSchema<ParsedResult>({
          systemPrompt: sysPrompt, userMessage, temperature: 0.6, maxTokens: 6000,
        });
        parsed = r.parsed; cost_usd = r.cost_usd; model = DEEPSEEK_MODEL;
        break;
      }
      case 'grok': {
        const sysPrompt = `${systemPrompt}\n\n# REMINDER: respond with a JSON object exactly matching this shape (no prose around it):\n${JSON.stringify(REFRESH_TOOL_SCHEMA, null, 2)}`;
        const r = await callGrokWithSchema<ParsedResult>({
          systemPrompt: sysPrompt, userMessage, temperature: 0.6, maxTokens: 6000,
        });
        parsed = r.parsed; cost_usd = r.cost_usd; model = GROK_MODEL;
        break;
      }
      default: {
        const _exhaustive: never = provider;
        throw new Error(`unknown provider: ${_exhaustive}`);
      }
    }
  } catch (err) {
    stop();
    logger.logMinimal(`[${provider}] refresh failed:`, (err as Error).message);
    throw err;
  }
  stop();

  const generated = parsed.posts ?? [];
  const updatedIds: string[] = [];

  for (const gen of generated) {
    const target = targets.find((t) => t.platform_id === gen.platform_id);
    if (!target) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: nextVRows } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM post_versions WHERE post_id = $1`,
        [target.id],
      );
      await client.query(
        `INSERT INTO post_versions (post_id, version, title, body, hashtags, edited_by)
         VALUES ($1, $2, $3, $4, $5, 'ai')`,
        [target.id, nextVRows[0].next, target.title, target.body, target.hashtags],
      );

      await client.query(
        `UPDATE posts SET body = $1, title = $2 WHERE id = $3`,
        [gen.body, gen.title || null, target.id],
      );

      await client.query('COMMIT');
      updatedIds.push(target.id);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.logMinimal('refresh failed for', gen.platform_id, (err as Error).message);
    } finally {
      client.release();
    }
  }

  logger.log(`[${provider}] refreshed ${updatedIds.length} posts from source ${source.platform_id} in group ${groupId}, cost=$${cost_usd.toFixed(4)}`);
  return { updated_post_ids: updatedIds, provider, model, cost_usd };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
