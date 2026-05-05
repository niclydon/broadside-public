import { NextResponse } from 'next/server';
import { getValidAccessToken, fetchPostAnalytics } from '@/lib/linkedin/client';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/linkedin/analytics');

export const dynamic = 'force-dynamic';

/** Refresh analytics for all posted LinkedIn content that has a linkedin_urn. */
export async function POST() {
  const auth = await getValidAccessToken();
  if (!auth) {
    return NextResponse.json(
      { error: 'LinkedIn not connected. Visit /api/auth/linkedin to connect.' },
      { status: 401 },
    );
  }

  const pool = getPool();
  const { rows: posts } = await pool.query<{
    id: string;
    linkedin_urn: string;
    body: string;
  }>(`SELECT id, linkedin_urn, substring(body, 1, 60) AS body FROM posts WHERE linkedin_urn IS NOT NULL AND platform_id = 'linkedin'`);

  if (posts.length === 0) {
    return NextResponse.json({ refreshed: 0, message: 'no posts with linkedin_urn' });
  }

  let refreshed = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      const stats = await fetchPostAnalytics(auth.token, post.linkedin_urn);
      const engagementRate = stats.impressions > 0
        ? (stats.likes + stats.comments + stats.shares + stats.clicks) / stats.impressions
        : null;

      await pool.query(
        `INSERT INTO post_analytics
           (post_id, platform_id, impressions, unique_impressions, likes, comments, shares, clicks, engagement_rate, raw_stats)
         VALUES ($1, 'linkedin', $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          post.id,
          stats.impressions,
          stats.unique_impressions,
          stats.likes,
          stats.comments,
          stats.shares,
          stats.clicks,
          engagementRate,
          JSON.stringify(stats.raw),
        ],
      );
      refreshed++;
    } catch (err) {
      logger.logMinimal('analytics failed for', post.linkedin_urn, (err as Error).message);
      failed++;
    }
  }

  logger.log(`analytics refreshed: ${refreshed} ok, ${failed} failed`);
  return NextResponse.json({ refreshed, failed, total_posts: posts.length });
}

/** GET: return latest analytics per post. */
export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (pa.post_id)
       pa.post_id, pa.impressions, pa.unique_impressions, pa.likes,
       pa.comments, pa.shares, pa.clicks, pa.engagement_rate, pa.fetched_at,
       p.linkedin_urn, substring(p.body, 1, 100) AS body_preview,
       cg.status AS group_status
     FROM post_analytics pa
     JOIN posts p ON p.id = pa.post_id
     JOIN content_groups cg ON cg.id = p.content_group_id
     ORDER BY pa.post_id, pa.fetched_at DESC`,
  );
  return NextResponse.json({ analytics: rows });
}
