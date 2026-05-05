import { getPool } from '@/lib/db/pool';
import { publishToLinkedIn } from '@/lib/linkedin/publish';
import { publishToBluesky } from '@/lib/bluesky/client';
import { postTweet } from '@/lib/twitter/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('scheduler');

/**
 * Check for posts that are scheduled and due for publishing.
 * Called by the /api/cron/publish route (triggered externally or by setInterval).
 */
export async function publishScheduledPosts(): Promise<{
  published: number;
  failed: number;
  errors: string[];
}> {
  const pool = getPool();
  let published = 0;
  let failed = 0;
  const errors: string[] = [];

  // Find content_groups that are scheduled and due
  const { rows: dueGroups } = await pool.query<{
    cg_id: string;
    post_id: string;
    platform_id: string;
    body: string;
    hashtags: string[];
  }>(
    `SELECT cg.id AS cg_id, p.id AS post_id, p.platform_id, p.body, p.hashtags
       FROM content_groups cg
       JOIN posts p ON p.content_group_id = cg.id
      WHERE cg.status = 'scheduled'
        AND cg.scheduled_at <= now()
        AND p.status = 'scheduled'
      ORDER BY cg.scheduled_at ASC
      LIMIT 20`,
  );

  if (dueGroups.length === 0) {
    logger.logVerbose('no scheduled posts due');
    return { published: 0, failed: 0, errors: [] };
  }

  logger.log(`${dueGroups.length} scheduled posts due for publishing`);

  for (const post of dueGroups) {
    try {
      let postedUrl: string | null = null;

      switch (post.platform_id) {
        case 'linkedin': {
          const result = await publishToLinkedIn(post.post_id);
          postedUrl = result.posted_url;
          break;
        }
        case 'bluesky': {
          let text = post.body;
          if (post.hashtags?.length > 0) {
            text += '\n\n' + post.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
          }
          if ([...text].length > 300) text = [...text].slice(0, 297).join('') + '…';
          const result = await publishToBluesky(text);
          postedUrl = result.postUrl;
          // Update the post record
          await pool.query(
            `UPDATE posts SET status = 'posted', posted_at = now(), posted_url = $1 WHERE id = $2`,
            [postedUrl, post.post_id],
          );
          break;
        }
        case 'twitter': {
          let text = post.body;
          if (post.hashtags?.length > 0) {
            text += '\n\n' + post.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
          }
          const result = await postTweet(text);
          postedUrl = result.tweetUrl;
          await pool.query(
            `UPDATE posts SET status = 'posted', posted_at = now(), posted_url = $1 WHERE id = $2`,
            [postedUrl, post.post_id],
          );
          break;
        }
        case 'substack': {
          logger.logVerbose('substack auto-publish not supported — skipping');
          continue;
        }
        default: {
          logger.logVerbose(`unknown platform ${post.platform_id} — skipping`);
          continue;
        }
      }

      // Mark the content_group as posted if all posts are done
      await pool.query(
        `UPDATE content_groups cg SET status = 'posted'
          WHERE cg.id = $1
            AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.content_group_id = cg.id AND p.status NOT IN ('posted', 'archived'))`,
        [post.cg_id],
      );

      published++;
      logger.log(`auto-published ${post.platform_id} post ${post.post_id} → ${postedUrl}`);
    } catch (err) {
      failed++;
      const msg = `${post.platform_id}/${post.post_id}: ${(err as Error).message.slice(0, 120)}`;
      errors.push(msg);
      logger.logMinimal('auto-publish failed:', msg);
    }
  }

  return { published, failed, errors };
}

/**
 * Check for evergreen posts that need recycling.
 */
export async function recycleEvergreenPosts(): Promise<{ recycled: number }> {
  const pool = getPool();

  const { rows } = await pool.query<{
    cg_id: string;
    post_id: string;
    platform_id: string;
    body: string;
    recycle_interval_days: number;
    recycle_count: number;
  }>(
    `SELECT cg.id AS cg_id, p.id AS post_id, p.platform_id, p.body,
            cg.recycle_interval_days, cg.recycle_count
       FROM content_groups cg
       JOIN posts p ON p.content_group_id = cg.id
      WHERE cg.is_evergreen = true
        AND cg.recycle_interval_days IS NOT NULL
        AND cg.status = 'posted'
        AND p.status = 'posted'
        AND (cg.last_recycled_at IS NULL
             OR cg.last_recycled_at + (cg.recycle_interval_days || ' days')::interval <= now())
      ORDER BY cg.last_recycled_at NULLS FIRST
      LIMIT 5`,
  );

  if (rows.length === 0) return { recycled: 0 };

  logger.log(`${rows.length} evergreen posts due for recycling`);
  let recycled = 0;

  for (const row of rows) {
    // Create a variation of the post as a new content_group (child)
    // For now, just re-queue the same text — LLM-powered variation is a future enhancement
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: cgRows } = await client.query<{ id: string }>(
          `INSERT INTO content_groups (parent_group_id, brand_id, topic_id, status, source, repurpose_type, notes)
           SELECT $1, cg.brand_id, cg.topic_id, 'queued', 'ai_draft', 'recycle',
                  'Recycled from evergreen post (cycle #' || (cg.recycle_count + 1) || ')'
             FROM content_groups cg WHERE cg.id = $1
           RETURNING id`,
          [row.cg_id],
        );
        await client.query(
          `INSERT INTO posts (content_group_id, platform_id, body, status)
           VALUES ($1, $2, $3, 'queued')`,
          [cgRows[0].id, row.platform_id, row.body],
        );
        await client.query(
          `UPDATE content_groups SET last_recycled_at = now(), recycle_count = recycle_count + 1 WHERE id = $1`,
          [row.cg_id],
        );
        await client.query('COMMIT');
        recycled++;
      } catch (err) {
        await client.query('ROLLBACK');
        logger.logMinimal('recycle failed:', (err as Error).message);
      } finally {
        client.release();
      }
    } catch (err) {
      logger.logMinimal('recycle pool error:', (err as Error).message);
    }
  }

  return { recycled };
}
