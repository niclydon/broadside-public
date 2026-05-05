import { query } from '@/lib/db/pool';
import type { Metadata } from 'next';
import { SignalPulse } from '@/components/SignalPulse';

export const metadata: Metadata = { title: 'Activity — Broadside' };
export const dynamic = 'force-dynamic';

interface PostedItem {
  content_group_id: string;
  platform_id: string;
  body_preview: string;
  posted_at: string;
  posted_url: string | null;
  topic_name: string | null;
  topic_color: string | null;
}

interface TopicCount {
  topic_name: string | null;
  topic_color: string | null;
  post_count: string;
}

interface WeeklyCadence {
  week: string;
  count: string;
}

async function loadPipelineStats() {
  try {
    const { rows } = await query<{
      total_posted: string;
      posted_this_week: string;
      posted_this_month: string;
      total_drafts: string;
      pending_suggestions: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM posts WHERE status = 'posted') AS total_posted,
         (SELECT COUNT(*)::text FROM posts WHERE status = 'posted' AND posted_at >= now() - interval '7 days') AS posted_this_week,
         (SELECT COUNT(*)::text FROM posts WHERE status = 'posted' AND posted_at >= now() - interval '30 days') AS posted_this_month,
         (SELECT COUNT(*)::text FROM content_groups WHERE status = 'draft') AS total_drafts,
         (SELECT COUNT(*)::text FROM draft_candidates WHERE NOT accepted AND NOT rejected) AS pending_suggestions`,
    );
    return rows[0];
  } catch {
    return { total_posted: '0', posted_this_week: '0', posted_this_month: '0', total_drafts: '0', pending_suggestions: '0' };
  }
}

async function loadPostedTimeline(): Promise<PostedItem[]> {
  try {
    const { rows } = await query<PostedItem>(
      `SELECT p.content_group_id, p.platform_id,
              substring(p.body, 1, 140) AS body_preview,
              p.posted_at, p.posted_url,
              t.name AS topic_name, t.color AS topic_color
         FROM posts p
         JOIN content_groups cg ON cg.id = p.content_group_id
         LEFT JOIN topics t ON t.id = cg.topic_id
        WHERE p.status = 'posted' AND p.posted_at IS NOT NULL
        ORDER BY p.posted_at DESC
        LIMIT 50`,
    );
    return rows;
  } catch {
    return [];
  }
}

async function loadTopicCounts(): Promise<TopicCount[]> {
  try {
    const { rows } = await query<TopicCount>(
      `SELECT t.name AS topic_name, t.color AS topic_color,
              COUNT(DISTINCT cg.id)::text AS post_count
         FROM content_groups cg
         LEFT JOIN topics t ON t.id = cg.topic_id
         JOIN posts p ON p.content_group_id = cg.id AND p.status = 'posted'
        GROUP BY t.name, t.color
        ORDER BY post_count DESC`,
    );
    return rows;
  } catch {
    return [];
  }
}

async function loadWeeklyCadence(): Promise<WeeklyCadence[]> {
  try {
    const { rows } = await query<WeeklyCadence>(
      `SELECT date_trunc('week', posted_at)::date::text AS week,
              COUNT(*)::text AS count
         FROM posts
        WHERE status = 'posted' AND posted_at >= now() - interval '12 weeks'
        GROUP BY 1 ORDER BY 1`,
    );
    return rows;
  } catch {
    return [];
  }
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function ActivityPage() {
  const [stats, timeline, topics, cadence] = await Promise.all([
    loadPipelineStats(),
    loadPostedTimeline(),
    loadTopicCounts(),
    loadWeeklyCadence(),
  ]);

  const avgPerWeek = cadence.length > 0
    ? (cadence.reduce((sum, w) => sum + parseInt(w.count), 0) / cadence.length).toFixed(1)
    : '0';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bs-label">Activity</div>
      <h1 className="text-2xl font-semibold text-[var(--text)] mt-1 mb-6">Publishing activity</h1>

      {/* Pipeline stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        {[
          { label: 'Total posted', value: stats.total_posted, color: '#4ade80' },
          { label: 'This week', value: stats.posted_this_week, color: '#5aadf0' },
          { label: 'This month', value: stats.posted_this_month, color: '#a78bfa' },
          { label: 'Drafts in progress', value: stats.total_drafts, color: '#6b6b7a' },
          { label: 'Pending suggestions', value: stats.pending_suggestions, color: '#fbbf24' },
        ].map((s) => (
          <div key={s.label} className="bs-card p-4">
            <div className="bs-label">{s.label}</div>
            <div className="text-3xl font-semibold font-mono tabular-nums mt-2" style={{ color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Cadence + Topics row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Weekly cadence */}
        <div className="bs-card p-4">
          <div className="bs-label mb-3">Publishing cadence (12 weeks)</div>
          {cadence.length === 0 ? (
            <p className="text-xs text-[var(--muted)] italic">No published posts yet.</p>
          ) : (
            <>
              <div className="flex items-end gap-1 h-20 mb-3">
                {cadence.map((w) => {
                  const count = parseInt(w.count);
                  const max = Math.max(...cadence.map((c) => parseInt(c.count)), 1);
                  const pct = Math.max((count / max) * 100, 4);
                  return (
                    <div
                      key={w.week}
                      className="flex-1 rounded-t bg-[var(--accent)] opacity-70 hover:opacity-100 transition-opacity"
                      style={{ height: `${pct}%` }}
                      title={`Week of ${w.week}: ${w.count} posts`}
                    />
                  );
                })}
              </div>
              <p className="text-xs text-[var(--text-dim)]">
                Avg <span className="font-mono text-[var(--accent)]">{avgPerWeek}</span> posts/week
              </p>
            </>
          )}
        </div>

        {/* By topic */}
        <div className="bs-card p-4">
          <div className="bs-label mb-3">By topic</div>
          {topics.length === 0 ? (
            <p className="text-xs text-[var(--muted)] italic">No posted content yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {topics.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.topic_color ?? 'var(--muted)' }} />
                  <span className="text-[var(--text)]">{t.topic_name ?? 'Uncategorized'}</span>
                  <span className="font-mono tabular-nums text-[var(--text-dim)] ml-auto">{t.post_count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Topic pulse — external signal trends */}
      <div className="mb-8">
        <SignalPulse />
      </div>

      {/* Timeline */}
      <div className="bs-card p-4">
        <div className="bs-label mb-3">Recent posts ({timeline.length})</div>
        {timeline.length === 0 ? (
          <p className="text-xs text-[var(--muted)] italic">
            No published posts yet. Accept suggestions and publish to see your timeline here.
          </p>
        ) : (
          <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
            {timeline.map((item, i) => (
              <a
                key={`${item.content_group_id}-${item.platform_id}-${i}`}
                href={item.posted_url ?? `/posts/${item.content_group_id}`}
                target={item.posted_url ? '_blank' : undefined}
                className="flex items-center gap-3 p-2 rounded hover:bg-[var(--surface-2)] transition-colors"
              >
                <span className="text-[0.6875rem] text-[var(--muted)] font-mono tabular-nums w-14 flex-shrink-0">
                  {relativeTime(item.posted_at)}
                </span>
                <span className="bs-pill font-mono text-[0.5625rem]">{capitalize(item.platform_id)}</span>
                {item.topic_name && (
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.topic_color ?? 'var(--accent)' }} />
                )}
                <span className="text-xs text-[var(--text)] truncate flex-1">{item.body_preview}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
