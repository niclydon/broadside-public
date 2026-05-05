import { z } from 'zod';
import type { PostStatus } from './types';

export const uuidSchema = z.string().uuid();

export const postStatusSchema = z.enum([
  'draft',
  'queued',
  'scheduled',
  'ready',
  'posted',
  'archived',
]) satisfies z.ZodType<PostStatus>;

export const createContentGroupSchema = z.object({
  topic_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  platform_ids: z.array(z.string()).min(1).default(['linkedin', 'substack']),
  tag_slugs: z.array(z.string().max(60)).optional(),
  initial_body: z.string().max(20000).optional(),
  source: z.enum(['manual', 'ai_draft', 'imported']).default('manual'),
});

export const updateContentGroupSchema = z.object({
  topic_id: z.string().uuid().nullable().optional(),
  parent_group_id: z.string().uuid().nullable().optional(),
  status: postStatusSchema.optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tag_slugs: z.array(z.string().max(60)).optional(),
});

export const movePostSchema = z.object({
  target_group_id: z.string().uuid(),
});

export const updatePostSchema = z.object({
  title: z.string().max(300).nullable().optional(),
  body: z.string().max(20000).optional(),
  body_html: z.string().nullable().optional(),
  hashtags: z.array(z.string().max(60)).optional(),
  edited_by: z.enum(['human', 'ai', 'import']).default('human'),
});

export const publishPostSchema = z.object({
  posted_url: z.string().url().optional(),
  posted_at: z.string().datetime().optional(),
});

export const createTopicSchema = z.object({
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  sort_order: z.number().int().default(100),
});
