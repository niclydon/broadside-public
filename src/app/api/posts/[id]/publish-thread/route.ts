import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';
import { parseThreadBody, isThreadBody } from '@/lib/threads';
import { postTwitterThread } from '@/lib/twitter/client';
import { publishBlueskyThread } from '@/lib/bluesky/client';
import { validatePostBrandPlatform, BrandPlatformError } from '@/lib/brand-platform-check';

const logger = createLogger('api/posts/publish-thread');

export const dynamic = 'force-dynamic';

interface PostRow {
  id: string;
  content_group_id: string;
  platform_id: string;
  body: string;
  status: string;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
  const { rows } = await pool.query<PostRow>(
    `SELECT id, content_group_id, platform_id, body, status FROM posts WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'post not found' }, { status: 404 });
  }

  const post = rows[0];
  if (post.platform_id !== 'twitter' && post.platform_id !== 'bluesky') {
    return NextResponse.json(
      { error: `threads only supported on twitter/bluesky, not ${post.platform_id}` },
      { status: 400 },
    );
  }

  if (!isThreadBody(post.body)) {
    return NextResponse.json(
      { error: 'post body does not look like a thread (missing [N/M] markers or --- separators)' },
      { status: 400 },
    );
  }

  const parts = parseThreadBody(post.body);
  if (parts.length < 2) {
    return NextResponse.json(
      { error: `parsed only ${parts.length} part(s); need at least 2 for a thread` },
      { status: 400 },
    );
  }

  // Enforce per-platform length limits per part
  const limit = post.platform_id === 'twitter' ? 280 : 300;
  const overLength = parts
    .map((p, i) => ({ i, len: [...p].length }))
    .filter((p) => p.len > limit);
  if (overLength.length > 0) {
    return NextResponse.json(
      {
        error: `parts exceed ${limit}-char limit: ${overLength
          .map((p) => `#${p.i + 1} (${p.len})`)
          .join(', ')}`,
      },
      { status: 400 },
    );
  }

  logger.log(`publishing ${parts.length}-part thread on ${post.platform_id} for post ${id}`);

  try {
    let rootUrl: string;
    let externalIds: string[];

    if (post.platform_id === 'twitter') {
      const result = await postTwitterThread(parts, brandSlug);
      rootUrl = result.rootUrl;
      externalIds = result.tweetIds;
    } else {
      const result = await publishBlueskyThread(parts, brandSlug);
      rootUrl = result.rootUrl;
      externalIds = result.uris;
    }

    // Mark the post as posted with the root URL
    await pool.query(
      `UPDATE posts SET status = 'posted', posted_at = now(), posted_url = $1, updated_at = now()
        WHERE id = $2`,
      [rootUrl, post.id],
    );

    logger.log(`thread posted; ${externalIds.length} items; root: ${rootUrl}`);

    return NextResponse.json({
      ok: true,
      root_url: rootUrl,
      parts: externalIds.length,
      external_ids: externalIds,
    });
  } catch (err) {
    logger.logMinimal('thread publish failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
