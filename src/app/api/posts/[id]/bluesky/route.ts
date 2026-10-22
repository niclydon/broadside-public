import { NextResponse } from 'next/server';
import { publishToBluesky, uploadBlob } from '@/lib/bluesky/client';
import { getPool } from '@/lib/db/pool';
import { listMedia, getMediaFilePath } from '@/lib/media';
import { readFile } from 'node:fs/promises';
import { uuidSchema } from '@/lib/validation';
import { validatePostBrandPlatform, BrandPlatformError } from '@/lib/brand-platform-check';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/posts/bluesky');

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
  const { rows } = await pool.query<{ id: string; body: string; hashtags: string[]; status: string; platform_id: string }>(
    `SELECT id, body, hashtags, status, platform_id FROM posts WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'post not found' }, { status: 404 });
  const post = rows[0];

  if (post.status === 'posted') {
    return NextResponse.json({ error: 'already posted' }, { status: 409 });
  }

  // For Bluesky posts, use the body directly.
  // For LinkedIn/Substack posts being cross-posted, truncate to 300 chars.
  let text = post.body;
  if (post.hashtags && post.hashtags.length > 0) {
    const tags = post.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    text = `${post.body}\n\n${tags}`;
  }

  // Bluesky limit is 300 grapheme clusters. Truncate if needed.
  if ([...text].length > 300) {
    text = [...text].slice(0, 297).join('') + '…';
  }

  // Upload images from the content group if any
  const { rows: cgRow } = await pool.query<{ content_group_id: string }>(
    `SELECT content_group_id FROM posts WHERE id = $1`, [id],
  );
  const imageEmbeds: Array<{ blob: { $type: string; ref: { $link: string }; mimeType: string; size: number }; alt: string }> = [];
  if (cgRow[0]?.content_group_id) {
    try {
      const mediaItems = await listMedia(cgRow[0].content_group_id);
      const images = mediaItems.filter((m) => m.mime_type?.startsWith('image/')).slice(0, 4);
      for (const img of images) {
        const data = await readFile(getMediaFilePath(img));
        const blob = await uploadBlob(data, img.mime_type ?? 'image/jpeg', brandSlug);
        imageEmbeds.push({ blob, alt: img.alt_text ?? '' });
      }
    } catch (err) {
      logger.logMinimal('bluesky image attach failed:', (err as Error).message);
    }
  }

  try {
    const result = await publishToBluesky(text, imageEmbeds.length > 0 ? imageEmbeds : undefined, undefined, brandSlug);

    // If this is a bluesky platform post, mark it posted
    if (post.platform_id === 'bluesky') {
      await pool.query(
        `UPDATE posts SET status = 'posted', posted_at = now(), posted_url = $1 WHERE id = $2`,
        [result.postUrl, id],
      );
      // Check if all siblings posted
      await pool.query(
        `UPDATE content_groups cg SET status = 'posted'
          WHERE cg.id = (SELECT content_group_id FROM posts WHERE id = $1)
            AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.content_group_id = cg.id AND p.status <> 'posted')`,
        [id],
      );
    }

    return NextResponse.json({
      uri: result.uri,
      cid: result.cid,
      posted_url: result.postUrl,
    });
  } catch (err) {
    logger.logMinimal('bluesky publish failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
