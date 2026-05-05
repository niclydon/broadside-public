import { createLogger } from '@/lib/logger';

const logger = createLogger('bluesky/analytics');

const BSKY_API = 'https://public.api.bsky.app/xrpc';

export interface BlueskyPostStats {
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
}

/** Fetch engagement stats for a Bluesky post by its AT URI.
 *  Uses the public API — no auth required. */
export async function fetchBlueskyPostStats(atUri: string): Promise<BlueskyPostStats> {
  const stop = logger.time(`stats(${atUri.slice(-10)})`);
  try {
    const res = await fetch(
      `${BSKY_API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}&depth=0`,
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bluesky getPostThread failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
    const data = await res.json() as {
      thread?: {
        post?: {
          likeCount?: number;
          repostCount?: number;
          replyCount?: number;
          quoteCount?: number;
        };
      };
    };
    stop();

    const post = data.thread?.post;
    return {
      likes: post?.likeCount ?? 0,
      reposts: post?.repostCount ?? 0,
      replies: post?.replyCount ?? 0,
      quotes: post?.quoteCount ?? 0,
    };
  } catch (err) {
    stop();
    logger.logMinimal('bluesky stats error:', (err as Error).message);
    throw err;
  }
}
