import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/signals/pulse');

export const dynamic = 'force-dynamic';

const RELEVANCE_THRESHOLD = 0.5;

interface TopicRow {
  slug: string;
  name: string;
  color: string | null;
}

interface SignalRow {
  id: string;
  title: string;
  topic_scores: Record<string, number>;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '7', 10) || 7, 1), 90);

  try {
    // Load topics
    const { rows: topics } = await query<TopicRow>(
      `SELECT slug, name, color FROM topics ORDER BY sort_order`,
    );

    // Load signals from current period
    const { rows: currentSignals } = await query<SignalRow>(
      `SELECT id, title, topic_scores, metadata, occurred_at::text
         FROM context_items
        WHERE kind = 'external_signal'
          AND topic_scores IS NOT NULL
          AND occurred_at >= now() - make_interval(days => $1)
        ORDER BY occurred_at DESC`,
      [days],
    );

    // Load signals from previous period for trend comparison
    const { rows: prevSignals } = await query<SignalRow>(
      `SELECT id, topic_scores
         FROM context_items
        WHERE kind = 'external_signal'
          AND topic_scores IS NOT NULL
          AND occurred_at >= now() - make_interval(days => $1)
          AND occurred_at < now() - make_interval(days => $2)`,
      [days * 2, days],
    );

    const topicPulse = topics.map((topic) => {
      // Count signals above relevance threshold for this topic
      const matching = currentSignals.filter(
        (s) => (s.topic_scores[topic.slug] ?? 0) >= RELEVANCE_THRESHOLD,
      );
      const prevMatching = prevSignals.filter(
        (s) => (s.topic_scores[topic.slug] ?? 0) >= RELEVANCE_THRESHOLD,
      );

      // Source breakdown
      const bySource: Record<string, number> = {};
      for (const s of matching) {
        const src = (s.metadata.source as string) ?? 'unknown';
        bySource[src] = (bySource[src] ?? 0) + 1;
      }

      // Trend
      const cur = matching.length;
      const prev = prevMatching.length;
      let trend: 'up' | 'down' | 'steady' | 'new' = 'steady';
      if (prev === 0 && cur > 0) trend = 'new';
      else if (cur > prev * 1.3) trend = 'up';
      else if (cur < prev * 0.7) trend = 'down';

      // Top signals (highest topic score)
      const topSignals = matching
        .sort((a, b) => (b.topic_scores[topic.slug] ?? 0) - (a.topic_scores[topic.slug] ?? 0))
        .slice(0, 3)
        .map((s) => ({
          title: s.title,
          source: s.metadata.source as string,
          score: s.topic_scores[topic.slug] ?? 0,
          url: (s.metadata.url as string) ?? null,
          occurred_at: s.occurred_at,
        }));

      return {
        slug: topic.slug,
        name: topic.name,
        color: topic.color,
        signal_count: cur,
        by_source: bySource,
        trend,
        prev_period_count: prev,
        top_signals: topSignals,
      };
    });

    return NextResponse.json({
      window_days: days,
      topics: topicPulse,
      total_signals: currentSignals.length,
    });
  } catch (err) {
    logger.logMinimal('pulse failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
