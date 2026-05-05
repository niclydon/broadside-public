import { NextResponse } from 'next/server';
import { getValidAccessToken, fetchMyPosts } from '@/lib/linkedin/client';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';
import { currentBrand } from '@/lib/brand';

const logger = createLogger('api/linkedin/import');

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const countParam = url.searchParams.get('count');
  const count = countParam ? Math.min(parseInt(countParam, 10) || 20, 100) : 20;

  const auth = await getValidAccessToken();
  if (!auth) {
    return NextResponse.json(
      { error: 'LinkedIn not connected. Visit /api/auth/linkedin to connect.' },
      { status: 401 },
    );
  }

  try {
    const linkedinPosts = await fetchMyPosts(auth.token, auth.memberUrn, count);
    if (linkedinPosts.length === 0) {
      return NextResponse.json({ imported: 0, skipped: 0, message: 'no posts found' });
    }

    const pool = getPool();
    const brand = await currentBrand();
    let imported = 0;
    let skipped = 0;

    for (const lp of linkedinPosts) {
      if (!lp.text || lp.text.trim().length === 0) {
        skipped++;
        continue;
      }

      // Check if this URN is already imported
      const { rows: existing } = await pool.query(
        `SELECT id FROM posts WHERE linkedin_urn = $1`,
        [lp.urn],
      );
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // Create content_group + post
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { rows: cgRows } = await client.query<{ id: string }>(
          `INSERT INTO content_groups (brand_id, status, source, notes)
           VALUES ($1, 'posted', 'imported', 'Imported from LinkedIn')
           RETURNING id`,
          [brand.id],
        );
        const cgId = cgRows[0].id;

        await client.query(
          `INSERT INTO posts (content_group_id, platform_id, body, status, posted_at, linkedin_urn)
           VALUES ($1, 'linkedin', $2, 'posted', $3, $4)`,
          [cgId, lp.text, lp.created_at, lp.urn],
        );

        // Also add to voice_samples for future style modeling
        await client.query(
          `INSERT INTO voice_samples (platform_id, body, is_published, notes)
           VALUES ('linkedin', $1, true, $2)`,
          [lp.text, `Imported from LinkedIn (${lp.urn})`],
        );

        await client.query('COMMIT');
        imported++;
      } catch (err) {
        await client.query('ROLLBACK');
        logger.logMinimal('import failed for', lp.urn, (err as Error).message);
      } finally {
        client.release();
      }
    }

    logger.log(`imported ${imported} posts, skipped ${skipped}`);
    return NextResponse.json({ imported, skipped, total_fetched: linkedinPosts.length });
  } catch (err) {
    logger.logMinimal('import failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
