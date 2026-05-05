import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('bluesky/engagement');

const BSKY_API = 'https://public.api.bsky.app/xrpc';

interface ThreadReply {
  author_handle: string;
  author_name: string;
  content: string;
  external_id: string;
  external_url: string;
  occurred_at: string;
}

/** Fetch replies to a Bluesky post and store in post_engagements. */
export async function fetchBlueskyReplies(postId: string, atUri: string): Promise<number> {
  const stop = logger.time(`replies(${atUri.slice(-10)})`);
  try {
    const res = await fetch(
      `${BSKY_API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}&depth=1`,
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getPostThread failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const data = await res.json() as {
      thread?: {
        replies?: Array<{
          post?: {
            uri?: string;
            author?: { handle?: string; displayName?: string };
            record?: { text?: string; createdAt?: string };
          };
        }>;
      };
    };
    stop();

    const replies = (data.thread?.replies ?? [])
      .filter((r) => r.post?.record?.text)
      .map((r): ThreadReply => {
        const rkey = r.post!.uri?.split('/').pop() ?? '';
        const handle = r.post!.author?.handle ?? '';
        return {
          author_handle: handle,
          author_name: r.post!.author?.displayName ?? handle,
          content: r.post!.record!.text!,
          external_id: r.post!.uri ?? '',
          external_url: `https://bsky.app/profile/${handle}/post/${rkey}`,
          occurred_at: r.post!.record!.createdAt ?? new Date().toISOString(),
        };
      });

    if (replies.length === 0) return 0;

    const pool = getPool();
    let inserted = 0;
    for (const reply of replies) {
      try {
        const { rowCount } = await pool.query(
          `INSERT INTO post_engagements
             (post_id, platform_id, engagement_type, author_handle, author_name, content, external_id, external_url, occurred_at)
           VALUES ($1, 'bluesky', 'reply', $2, $3, $4, $5, $6, $7)
           ON CONFLICT (post_id, platform_id, external_id) DO NOTHING`,
          [postId, reply.author_handle, reply.author_name, reply.content, reply.external_id, reply.external_url, reply.occurred_at],
        );
        if (rowCount && rowCount > 0) inserted++;
      } catch (err) {
        logger.logMinimal('insert reply failed:', (err as Error).message);
      }
    }

    logger.log(`fetched ${replies.length} replies for ${atUri.slice(-10)}, ${inserted} new`);
    return inserted;
  } catch (err) {
    stop();
    logger.logMinimal('fetchBlueskyReplies error:', (err as Error).message);
    return 0;
  }
}

/** Fetch replies for ALL posted Bluesky posts. */
export async function fetchAllBlueskyEngagement(): Promise<{ posts_checked: number; new_replies: number }> {
  const pool = getPool();
  // Find Bluesky posts that have a posted_url containing bsky.app
  const { rows } = await pool.query<{ id: string; posted_url: string }>(
    `SELECT p.id, p.posted_url
       FROM posts p
      WHERE p.platform_id = 'bluesky'
        AND p.status = 'posted'
        AND p.posted_url IS NOT NULL
        AND p.posted_url LIKE '%bsky.app%'`,
  );

  let totalNew = 0;
  for (const post of rows) {
    // Convert bsky.app URL to AT URI
    // URL: https://bsky.app/profile/example.test/post/rkey
    // URI: at://did:plc:xxx/app.bsky.feed.post/rkey
    const match = post.posted_url.match(/bsky\.app\/profile\/([^/]+)\/post\/([^/]+)/);
    if (!match) continue;
    const [, handle, rkey] = match;

    // Resolve handle to DID
    try {
      const resolveRes = await fetch(`${BSKY_API}/../com.atproto.identity.resolveHandle?handle=${handle}`);
      if (!resolveRes.ok) continue;
      const { did } = await resolveRes.json() as { did: string };
      const atUri = `at://${did}/app.bsky.feed.post/${rkey}`;
      const newReplies = await fetchBlueskyReplies(post.id, atUri);
      totalNew += newReplies;
    } catch {
      // skip
    }
  }

  return { posts_checked: rows.length, new_replies: totalNew };
}
