import { getPool, query } from '@/lib/db/pool';
import { callOpusWithTool } from '@/lib/llm/anthropic';
import { createLogger } from '@/lib/logger';
import { validateBrandPlatforms } from '@/lib/brand-platform-check';
import type { Post } from '@/lib/types';

const logger = createLogger('drafts/repurpose');

const REPURPOSE_TOOL_NAME = 'emit_variants';

const REPURPOSE_TOOL_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    variants: {
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
          hook: { type: 'string', description: 'First line attention grabber' },
        },
        required: ['platform_id', 'body', 'title', 'hook'],
      },
    },
  },
  required: ['variants'],
};

interface RepurposeResult {
  content_group_ids: string[];
  variants_created: number;
}

/**
 * Take an existing post and auto-derive shorter/longer variants for other platforms.
 * Creates new content_groups linked via parent_group_id.
 */
export async function repurposePost(
  sourcePostId: string,
  targetPlatforms: string[],
): Promise<RepurposeResult> {
  const pool = getPool();

  // Load the source post
  const { rows: postRows } = await pool.query<Post & { content_group_id: string }>(
    `SELECT * FROM posts WHERE id = $1`,
    [sourcePostId],
  );
  if (postRows.length === 0) throw new Error('source post not found');
  const source = postRows[0];

  // Brand-platform enforcement: every target platform must have an enabled
  // account for this group's brand (substack is exempt — manual publish).
  const groupRows = await query<{ brand_id: string | null }>(
    `SELECT brand_id FROM content_groups WHERE id = $1`,
    [source.content_group_id],
  );
  const groupBrandId = groupRows.rows[0]?.brand_id;
  if (groupBrandId) {
    await validateBrandPlatforms(groupBrandId, targetPlatforms);
  }

  const platformRules: Record<string, string> = {
    twitter: 'X/Twitter: max 280 characters. Ultra-compressed. One sharp insight, one concrete detail. No hashtags unless organic.',
    bluesky: 'Bluesky: max 300 characters. Punchy micro-take. Every word earns its place.',
    linkedin: 'LinkedIn: up to 3000 chars. Hook → proof → insight → landing. 3-6 hashtags at end.',
    substack: 'Substack: full essay (400-1500 words). Markdown. Title under 100 chars. Expand the original idea into a complete piece with sections.',
  };

  const targetInstructions = targetPlatforms
    .map((p) => `- ${platformRules[p] ?? p}`)
    .join('\n');

  const systemPrompt = `You are repurposing a social media post into variants for other platforms.

The ORIGINAL post (platform: ${source.platform_id}) is:
---
${source.body}
---

Create one variant for each target platform below. Preserve the core insight and voice. Adapt length, structure, and tone to fit each platform's norms.

NEVER include UUIDs, database IDs, private IPs, API keys, file paths, or internal system names.

Target platforms:
${targetInstructions}`;

  const userMessage = `Create ${targetPlatforms.length} variant(s) of the post above. Use the emit_variants tool.`;

  const result = await callOpusWithTool<{ variants: Array<{ platform_id: string; body: string; title: string; hook: string }> }>({
    systemPrompt,
    userMessage,
    toolName: REPURPOSE_TOOL_NAME,
    toolInputSchema: REPURPOSE_TOOL_SCHEMA,
    temperature: 0.6,
    maxTokens: 4000,
  });

  const variants = result.parsed.variants ?? [];
  const groupIds: string[] = [];

  for (const v of variants) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create a child content_group linked to the parent, inheriting brand.
      const { rows: cgRows } = await client.query<{ id: string }>(
        `INSERT INTO content_groups (parent_group_id, brand_id, topic_id, status, source, repurpose_type, notes)
         SELECT $1, cg.brand_id, cg.topic_id, 'draft', 'ai_draft',
                CASE WHEN $3 IN ('twitter', 'bluesky') THEN 'teaser'
                     WHEN $3 = 'substack' THEN 'expansion'
                     ELSE 'variant' END,
                'Repurposed from ' || $3 || ' post'
           FROM content_groups cg
          WHERE cg.id = $2
         RETURNING id`,
        [source.content_group_id, source.content_group_id, v.platform_id],
      );
      const cgId = cgRows[0].id;

      await client.query(
        `INSERT INTO posts (content_group_id, platform_id, title, body, status)
         VALUES ($1, $2, $3, $4, 'draft')`,
        [cgId, v.platform_id, v.title || null, v.body],
      );

      await client.query('COMMIT');
      groupIds.push(cgId);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.logMinimal('repurpose variant failed:', (err as Error).message);
    } finally {
      client.release();
    }
  }

  logger.log(`repurposed post ${sourcePostId} → ${groupIds.length} variants`);
  return { content_group_ids: groupIds, variants_created: groupIds.length };
}
