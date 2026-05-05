import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('drafts/performance');

/**
 * Build a performance context block from post_analytics.
 * Tells the AI which topics, hooks, and formats have actually performed
 * well so it can learn from real audience feedback.
 */
export async function getPerformanceBlock(): Promise<string> {
  const pool = getPool();
  try {
    // Top 5 posts by total engagement
    const { rows: topPosts } = await pool.query<{
      body_preview: string;
      platform_id: string;
      topic_name: string | null;
      likes: number;
      comments: number;
      shares: number;
    }>(
      `SELECT substring(p.body, 1, 200) AS body_preview,
              p.platform_id,
              t.name AS topic_name,
              COALESCE(pa.likes, 0) AS likes,
              COALESCE(pa.comments, 0) AS comments,
              COALESCE(pa.shares, 0) AS shares
         FROM posts p
         JOIN content_groups cg ON cg.id = p.content_group_id
         LEFT JOIN topics t ON t.id = cg.topic_id
         LEFT JOIN LATERAL (
           SELECT likes, comments, shares FROM post_analytics
            WHERE post_id = p.id ORDER BY fetched_at DESC LIMIT 1
         ) pa ON true
        WHERE p.status = 'posted'
        ORDER BY (COALESCE(pa.likes, 0) + COALESCE(pa.comments, 0) * 3 + COALESCE(pa.shares, 0) * 2) DESC
        LIMIT 5`,
    );

    // Topic performance summary
    const { rows: topicStats } = await pool.query<{
      topic_name: string | null;
      post_count: string;
      avg_engagement: string;
    }>(
      `SELECT t.name AS topic_name,
              COUNT(DISTINCT p.id)::text AS post_count,
              ROUND(AVG(COALESCE(pa.likes, 0) + COALESCE(pa.comments, 0) + COALESCE(pa.shares, 0)), 1)::text AS avg_engagement
         FROM posts p
         JOIN content_groups cg ON cg.id = p.content_group_id
         LEFT JOIN topics t ON t.id = cg.topic_id
         LEFT JOIN LATERAL (
           SELECT likes, comments, shares FROM post_analytics
            WHERE post_id = p.id ORDER BY fetched_at DESC LIMIT 1
         ) pa ON true
        WHERE p.status = 'posted'
        GROUP BY t.name
       HAVING COUNT(DISTINCT p.id) >= 2
        ORDER BY AVG(COALESCE(pa.likes, 0) + COALESCE(pa.comments, 0) + COALESCE(pa.shares, 0)) DESC`,
    );

    if (topPosts.length === 0) return '';

    const hasEngagement = topPosts.some((p) => p.likes + p.comments + p.shares > 0);
    if (!hasEngagement) return '';

    let block = '\n\n# Performance data — what has actually worked\n\n';
    block += 'These are the author\'s top-performing posts by audience engagement. Learn from what resonated.\n\n';

    for (const p of topPosts) {
      block += `- [${p.platform_id}] ${p.topic_name ?? 'misc'} — ${p.likes}♥ ${p.comments}💬 ${p.shares}↗\n  "${p.body_preview}"\n\n`;
    }

    if (topicStats.length > 0) {
      block += 'Topic performance (avg engagement per post):\n';
      for (const t of topicStats) {
        block += `- ${t.topic_name ?? 'uncategorized'}: ${t.avg_engagement} avg across ${t.post_count} posts\n`;
      }
    }

    logger.logVerbose(`performance block: ${topPosts.length} top posts, ${topicStats.length} topic stats`);
    return block;
  } catch (err) {
    logger.logMinimal('performance block failed:', (err as Error).message);
    return '';
  }
}
