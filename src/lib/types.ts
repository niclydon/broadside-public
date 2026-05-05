// Broadside shared types. These mirror the Postgres schema — keep in sync
// with migrations/001-foundation.sql and 003-drafts.sql.

export type PostStatus =
  | 'draft'
  | 'queued'
  | 'scheduled'
  | 'ready'
  | 'posted'
  | 'archived';

export const POST_STATUSES: PostStatus[] = [
  'draft',
  'queued',
  'scheduled',
  'ready',
  'posted',
  'archived',
];

export type ContentSource = 'manual' | 'ai_draft' | 'imported';

export interface Topic {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface Platform {
  id: string;
  name: string;
  max_title_chars: number | null;
  max_body_chars: number | null;
  max_hashtags: number | null;
  supports_media: boolean;
  supports_rich_text: boolean;
  enabled: boolean;
  notes: string | null;
}

export interface ContentGroup {
  id: string;
  topic_id: string | null;
  parent_group_id: string | null;
  repurpose_type: string | null;
  status: PostStatus;
  scheduled_at: string | null;
  notes: string | null;
  source: ContentSource;
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: string;
  content_group_id: string;
  platform_id: string;
  title: string | null;
  body: string;
  body_html: string | null;
  char_count: number;
  hashtags: string[];
  status: PostStatus;
  posted_at: string | null;
  posted_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostVersion {
  id: string;
  post_id: string;
  version: number;
  title: string | null;
  body: string;
  body_html: string | null;
  hashtags: string[];
  edited_by: 'human' | 'ai' | 'import';
  created_at: string;
}

/** Lightweight summary for lineage display (children of a content group). */
export interface ContentGroupSummary {
  id: string;
  status: PostStatus;
  repurpose_type: string | null;
  platform_ids: string[];
  updated_at: string;
}

/** Row returned from the queue-list query: one content_group + its posts + topic + tags. */
export interface ContentGroupWithPosts extends ContentGroup {
  topic: Topic | null;
  posts: Post[];
  tags: Tag[];
  children?: ContentGroupSummary[];
}

export interface ContentGroupDetail extends ContentGroupWithPosts {
  versions: Record<string, PostVersion[]>; // post_id → versions (desc)
}
