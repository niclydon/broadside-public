import { randomUUID } from 'node:crypto';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';
import type {
  ContentGroup,
  ContentGroupDetail,
  ContentGroupSummary,
  ContentGroupWithPosts,
  Platform,
  Post,
  PostStatus,
  PostVersion,
  Tag,
  Topic,
} from '@/lib/types';

const logger = createLogger('content');

/** Slugify a free-form tag label into a safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listPlatforms(): Promise<Platform[]> {
  const pool = getPool();
  const { rows } = await pool.query<Platform>(
    `SELECT id, name, max_title_chars, max_body_chars, max_hashtags,
            supports_media, supports_rich_text, enabled, notes
       FROM platforms
      WHERE enabled = true
      ORDER BY id`,
  );
  return rows;
}

export async function listTopics(): Promise<Topic[]> {
  const pool = getPool();
  const { rows } = await pool.query<Topic>(
    `SELECT id, slug, name, description, color, sort_order, created_at, updated_at
       FROM topics
      ORDER BY sort_order, name`,
  );
  return rows;
}

export async function listTags(): Promise<Tag[]> {
  const pool = getPool();
  const { rows } = await pool.query<Tag>(
    `SELECT id, slug, name, created_at FROM tags ORDER BY slug`,
  );
  return rows;
}

/** List content groups with their posts + topic + tags. Used by the queue dashboard. */
export async function listContentGroups(opts: {
  status?: PostStatus;
  limit?: number;
} = {}): Promise<ContentGroupWithPosts[]> {
  const pool = getPool();
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.status) {
    params.push(opts.status);
    where.push(`cg.status = $${params.length}`);
  }
  const limit = opts.limit ?? 500;
  params.push(limit);

  const { rows } = await pool.query<{
    cg_id: string;
    topic_id: string | null;
    parent_group_id: string | null;
    repurpose_type: string | null;
    status: PostStatus;
    scheduled_at: string | null;
    notes: string | null;
    source: 'manual' | 'ai_draft' | 'imported';
    created_at: string;
    updated_at: string;
    topic_json: Topic | null;
    posts_json: Post[] | null;
    tags_json: Tag[] | null;
  }>(
    `SELECT
       cg.id AS cg_id,
       cg.topic_id,
       cg.parent_group_id,
       cg.repurpose_type,
       cg.status,
       cg.scheduled_at,
       cg.notes,
       cg.source,
       cg.created_at,
       cg.updated_at,
       to_jsonb(t) AS topic_json,
       (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.platform_id) FROM posts p WHERE p.content_group_id = cg.id) AS posts_json,
       (SELECT jsonb_agg(to_jsonb(tg) ORDER BY tg.slug)
          FROM content_group_tags cgt
          JOIN tags tg ON tg.id = cgt.tag_id
         WHERE cgt.content_group_id = cg.id) AS tags_json
     FROM content_groups cg
     LEFT JOIN topics t ON t.id = cg.topic_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY cg.updated_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    id: r.cg_id,
    topic_id: r.topic_id,
    parent_group_id: r.parent_group_id,
    repurpose_type: r.repurpose_type,
    status: r.status,
    scheduled_at: r.scheduled_at,
    notes: r.notes,
    source: r.source,
    created_at: r.created_at,
    updated_at: r.updated_at,
    topic: r.topic_json,
    posts: r.posts_json ?? [],
    tags: r.tags_json ?? [],
  }));
}

/** Full detail for one content group including version history per post. */
export async function getContentGroupDetail(id: string): Promise<ContentGroupDetail | null> {
  const pool = getPool();
  const { rows: groups } = await pool.query<{
    cg: ContentGroup;
    topic: Topic | null;
    posts: Post[] | null;
    tags: Tag[] | null;
  }>(
    `SELECT
       to_jsonb(cg) AS cg,
       to_jsonb(t) AS topic,
       (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.platform_id) FROM posts p WHERE p.content_group_id = cg.id) AS posts,
       (SELECT jsonb_agg(to_jsonb(tg) ORDER BY tg.slug)
          FROM content_group_tags cgt JOIN tags tg ON tg.id = cgt.tag_id
         WHERE cgt.content_group_id = cg.id) AS tags
     FROM content_groups cg
     LEFT JOIN topics t ON t.id = cg.topic_id
     WHERE cg.id = $1`,
    [id],
  );

  if (groups.length === 0) return null;
  const row = groups[0];
  const posts: Post[] = row.posts ?? [];

  const versions: Record<string, PostVersion[]> = {};
  if (posts.length > 0) {
    const postIds = posts.map((p) => p.id);
    const { rows: vRows } = await pool.query<PostVersion>(
      `SELECT id, post_id, version, title, body, hashtags, edited_by, created_at
         FROM post_versions
        WHERE post_id = ANY($1::uuid[])
        ORDER BY post_id, version DESC`,
      [postIds],
    );
    for (const v of vRows) {
      if (!versions[v.post_id]) versions[v.post_id] = [];
      versions[v.post_id].push(v);
    }
  }

  // Fetch direct children for lineage display.
  const { rows: childRows } = await pool.query<{
    id: string;
    status: PostStatus;
    repurpose_type: string | null;
    platform_ids: string[] | null;
    updated_at: string;
  }>(
    `SELECT cg.id, cg.status, cg.repurpose_type, cg.updated_at,
            (SELECT array_agg(p.platform_id) FROM posts p WHERE p.content_group_id = cg.id) AS platform_ids
       FROM content_groups cg
      WHERE cg.parent_group_id = $1
      ORDER BY cg.created_at`,
    [id],
  );
  const children: ContentGroupSummary[] = childRows.map((c) => ({
    id: c.id,
    status: c.status,
    repurpose_type: c.repurpose_type,
    platform_ids: c.platform_ids ?? [],
    updated_at: c.updated_at,
  }));

  return {
    ...row.cg,
    topic: row.topic,
    posts,
    tags: row.tags ?? [],
    children,
    versions,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateContentGroupInput {
  brand_id: string;
  topic_id?: string | null;
  notes?: string | null;
  platform_ids: string[];
  tag_slugs?: string[];
  initial_body?: string;
  source?: 'manual' | 'ai_draft' | 'imported';
}

export async function createContentGroup(input: CreateContentGroupInput): Promise<string> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cgId = randomUUID();
    await client.query(
      `INSERT INTO content_groups (id, brand_id, topic_id, notes, source, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')`,
      [cgId, input.brand_id, input.topic_id ?? null, input.notes ?? null, input.source ?? 'manual'],
    );

    // Create one post row per requested platform.
    const body = input.initial_body ?? '';
    for (const platformId of input.platform_ids) {
      await client.query(
        `INSERT INTO posts (content_group_id, platform_id, body, status)
         VALUES ($1, $2, $3, 'draft')`,
        [cgId, platformId, body],
      );
    }

    // Upsert tags by slug + link them.
    if (input.tag_slugs && input.tag_slugs.length > 0) {
      for (const rawSlug of input.tag_slugs) {
        const slug = slugify(rawSlug);
        if (!slug) continue;
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO tags (slug, name)
                VALUES ($1, $2)
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [slug, rawSlug],
        );
        await client.query(
          `INSERT INTO content_group_tags (content_group_id, tag_id)
                VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [cgId, rows[0].id],
        );
      }
    }

    await client.query('COMMIT');
    logger.log('Created content_group', cgId, `(platforms=${input.platform_ids.join(',')})`);
    return cgId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface UpdateContentGroupInput {
  topic_id?: string | null;
  parent_group_id?: string | null;
  status?: PostStatus;
  scheduled_at?: string | null;
  notes?: string | null;
  tag_slugs?: string[];
}

export async function updateContentGroup(id: string, input: UpdateContentGroupInput): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.topic_id !== undefined) {
      params.push(input.topic_id);
      sets.push(`topic_id = $${params.length}`);
    }
    if (input.status !== undefined) {
      params.push(input.status);
      sets.push(`status = $${params.length}`);
    }
    if (input.scheduled_at !== undefined) {
      params.push(input.scheduled_at);
      sets.push(`scheduled_at = $${params.length}`);
    }
    if (input.notes !== undefined) {
      params.push(input.notes);
      sets.push(`notes = $${params.length}`);
    }
    if (input.parent_group_id !== undefined) {
      // Circular reference check: walk ancestors from the proposed parent.
      if (input.parent_group_id !== null) {
        const { rows: cycleRows } = await client.query<{ found: boolean }>(
          `WITH RECURSIVE ancestors AS (
             SELECT id, parent_group_id, 1 AS depth FROM content_groups WHERE id = $1
             UNION ALL
             SELECT cg.id, cg.parent_group_id, a.depth + 1
               FROM content_groups cg JOIN ancestors a ON cg.id = a.parent_group_id
              WHERE a.depth < 10
           )
           SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = $2) AS found`,
          [input.parent_group_id, id],
        );
        if (cycleRows[0]?.found) {
          throw new Error('circular reference: target parent is a descendant of this group');
        }
      }
      params.push(input.parent_group_id);
      sets.push(`parent_group_id = $${params.length}`);
    }

    if (sets.length > 0) {
      params.push(id);
      await client.query(
        `UPDATE content_groups SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
      // When a group status changes, cascade to its posts if they're not already posted/archived.
      if (input.status) {
        await client.query(
          `UPDATE posts SET status = $1
             WHERE content_group_id = $2
               AND status NOT IN ('posted', 'archived')`,
          [input.status, id],
        );
      }
    }

    if (input.tag_slugs !== undefined) {
      await client.query(`DELETE FROM content_group_tags WHERE content_group_id = $1`, [id]);
      for (const rawSlug of input.tag_slugs) {
        const slug = slugify(rawSlug);
        if (!slug) continue;
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO tags (slug, name)
                VALUES ($1, $2)
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [slug, rawSlug],
        );
        await client.query(
          `INSERT INTO content_group_tags (content_group_id, tag_id)
                VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, rows[0].id],
        );
      }
    }

    await client.query('COMMIT');
    logger.log('Updated content_group', id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

}

export interface UpdatePostInput {
  title?: string | null;
  body?: string;
  body_html?: string | null;
  hashtags?: string[];
  edited_by?: 'human' | 'ai' | 'import';
}

export async function updatePost(postId: string, input: UpdatePostInput): Promise<Post> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Load current post to capture a version snapshot.
    const { rows: currentRows } = await client.query<Post>(
      `SELECT * FROM posts WHERE id = $1 FOR UPDATE`,
      [postId],
    );
    if (currentRows.length === 0) {
      throw new Error(`post ${postId} not found`);
    }
    const current = currentRows[0];

    // Determine next version number and write a snapshot row for the PREVIOUS state.
    const { rows: nextVRows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM post_versions WHERE post_id = $1`,
      [postId],
    );
    const nextVersion = nextVRows[0].next;

    await client.query(
      `INSERT INTO post_versions (post_id, version, title, body, body_html, hashtags, edited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        postId,
        nextVersion,
        current.title,
        current.body,
        current.body_html ?? null,
        current.hashtags,
        input.edited_by ?? 'human',
      ],
    );

    // Apply the update.
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.title !== undefined) {
      params.push(input.title);
      sets.push(`title = $${params.length}`);
    }
    if (input.body !== undefined) {
      params.push(input.body);
      sets.push(`body = $${params.length}`);
    }
    if (input.body_html !== undefined) {
      params.push(input.body_html);
      sets.push(`body_html = $${params.length}`);
    }
    if (input.hashtags !== undefined) {
      params.push(input.hashtags);
      sets.push(`hashtags = $${params.length}`);
    }
    if (sets.length === 0) {
      await client.query('COMMIT');
      return current;
    }

    params.push(postId);
    const { rows: updated } = await client.query<Post>(
      `UPDATE posts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );

    await client.query('COMMIT');
    logger.log('Updated post', postId, `v${nextVersion}`);
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function markPostPublished(
  postId: string,
  opts: { posted_url?: string; posted_at?: string } = {},
): Promise<Post> {
  const pool = getPool();
  const postedAt = opts.posted_at ?? new Date().toISOString();
  const { rows } = await pool.query<Post>(
    `UPDATE posts
        SET status = 'posted',
            posted_at = $1,
            posted_url = COALESCE($2, posted_url)
      WHERE id = $3
      RETURNING *`,
    [postedAt, opts.posted_url ?? null, postId],
  );
  if (rows.length === 0) throw new Error(`post ${postId} not found`);

  // If all sibling posts are now posted, mark the content_group posted too.
  await pool.query(
    `UPDATE content_groups cg
        SET status = 'posted'
      WHERE cg.id = $1
        AND NOT EXISTS (
          SELECT 1 FROM posts p
           WHERE p.content_group_id = cg.id AND p.status <> 'posted'
        )`,
    [rows[0].content_group_id],
  );

  logger.log('Marked post posted', postId);
  return rows[0];
}

export async function archiveContentGroup(id: string): Promise<void> {
  await updateContentGroup(id, { status: 'archived' });
  logger.log('Archived content_group', id);
}

// ---------------------------------------------------------------------------
// Move post between content groups
// ---------------------------------------------------------------------------

export interface MovePostResult {
  post: Post;
  source_group_deleted: boolean;
}

export async function movePost(postId: string, targetGroupId: string): Promise<MovePostResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock and load the post.
    const { rows: postRows } = await client.query<Post>(
      `SELECT * FROM posts WHERE id = $1 FOR UPDATE`,
      [postId],
    );
    if (postRows.length === 0) throw new Error(`post ${postId} not found`);
    const post = postRows[0];
    const sourceGroupId = post.content_group_id;

    if (sourceGroupId === targetGroupId) {
      throw new Error('post already belongs to the target group');
    }

    // Verify target group exists.
    const { rows: targetRows } = await client.query<{ id: string }>(
      `SELECT id FROM content_groups WHERE id = $1 FOR UPDATE`,
      [targetGroupId],
    );
    if (targetRows.length === 0) throw new Error(`target group ${targetGroupId} not found`);

    // Check for platform collision before the UPDATE.
    const { rows: collisionRows } = await client.query<{ id: string }>(
      `SELECT id FROM posts WHERE content_group_id = $1 AND platform_id = $2`,
      [targetGroupId, post.platform_id],
    );
    if (collisionRows.length > 0) {
      throw new Error(`target group already has a ${post.platform_id} post`);
    }

    // Move the post.
    const { rows: movedRows } = await client.query<Post>(
      `UPDATE posts SET content_group_id = $1 WHERE id = $2 RETURNING *`,
      [targetGroupId, postId],
    );

    // Clean up empty source group.
    const { rows: remainingRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM posts WHERE content_group_id = $1`,
      [sourceGroupId],
    );
    let sourceDeleted = false;
    if (parseInt(remainingRows[0].count) === 0) {
      await client.query(`DELETE FROM content_groups WHERE id = $1`, [sourceGroupId]);
      sourceDeleted = true;
      logger.log('Deleted empty source group', sourceGroupId);
    }

    await client.query('COMMIT');
    logger.log('Moved post', postId, `from ${sourceGroupId} to ${targetGroupId}`);
    return { post: movedRows[0], source_group_deleted: sourceDeleted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
