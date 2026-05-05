import { NextResponse } from 'next/server';
import { postTweet } from '@/lib/twitter/client';
import { getPool } from '@/lib/db/pool';
import { uuidSchema } from '@/lib/validation';
import { validatePostBrandPlatform, BrandPlatformError } from '@/lib/brand-platform-check';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/posts/twitter');

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let brandSlug: string | undefined;
  try {
    const validated = await validatePostBrandPlatform(id);
    brandSlug = validated.brand_slug ?? undefined;
  } catch (err) {
    if (err instanceof BrandPlatformError) {
      return NextResponse.json(err.toBody(), { status: 422 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const pool = getPool();
  const { rows } = await pool.query<{ id: string; body: string; hashtags: string[]; status: string }>(
    `SELECT id, body, hashtags, status FROM posts WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'post not found' }, { status: 404 });
  const post = rows[0];

  // Build text with hashtags
  let text = post.body;
  if (post.hashtags && post.hashtags.length > 0) {
    const tags = post.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    text = `${post.body}\n\n${tags}`;
  }

  try {
    const result = await postTweet(text, undefined, brandSlug);
    return NextResponse.json({ tweet_id: result.id, posted_url: result.tweetUrl });
  } catch (err) {
    logger.logMinimal('X publish failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
