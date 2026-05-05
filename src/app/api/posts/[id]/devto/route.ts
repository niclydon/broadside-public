import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';
import { getSetting } from '@/lib/settings/read';
import { publishToDevto } from '@/lib/devto/client';
import { validatePostBrandPlatform, BrandPlatformError } from '@/lib/brand-platform-check';

const logger = createLogger('api/posts/devto');

export const dynamic = 'force-dynamic';

interface PostRow {
  id: string;
  platform_id: string;
  title: string | null;
  body: string;
  hashtags: string[];
  status: string;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await validatePostBrandPlatform(id);
  } catch (err) {
    if (err instanceof BrandPlatformError) {
      return NextResponse.json(err.toBody(), { status: 422 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const pool = getPool();
  const { rows } = await pool.query<PostRow>(
    `SELECT id, platform_id, title, body, hashtags, status FROM posts WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'post not found' }, { status: 404 });
  }
  const post = rows[0];
  if (post.platform_id !== 'devto') {
    return NextResponse.json({ error: `post is on ${post.platform_id}, not devto` }, { status: 400 });
  }
  if (!post.title || !post.title.trim()) {
    return NextResponse.json({ error: 'Dev.to posts require a title' }, { status: 400 });
  }
  if (!post.body || !post.body.trim()) {
    return NextResponse.json({ error: 'post body is empty' }, { status: 400 });
  }

  const defaultTags = await getSetting<string[]>('devto.default_tags', []);
  const published = await getSetting<boolean>('devto.published_by_default', true);

  const tags = post.hashtags?.length ? post.hashtags : defaultTags;

  try {
    const result = await publishToDevto({
      title: post.title,
      bodyMarkdown: post.body,
      published,
      tags,
    });

    await pool.query(
      `UPDATE posts SET status = 'posted', posted_at = now(), posted_url = $1, updated_at = now()
        WHERE id = $2`,
      [result.url, post.id],
    );

    logger.log(`post ${id} published to Dev.to: ${result.url}`);
    return NextResponse.json({ ok: true, posted_url: result.url, devto_id: result.id, published });
  } catch (err) {
    logger.logMinimal('devto publish failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
