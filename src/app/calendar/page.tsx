import type { Metadata } from 'next';
import Link from 'next/link';
import { query } from '@/lib/db/pool';
import { CalendarGrid } from '@/components/CalendarGrid';

export const metadata: Metadata = { title: 'Calendar — Broadside' };
export const dynamic = 'force-dynamic';

interface CalendarPost {
  cg_id: string;
  status: string;
  scheduled_at: string | null;
  posted_at: string | null;
  platform_id: string;
  body_preview: string;
  topic_name: string | null;
  topic_color: string | null;
  pillar_name: string | null;
}

async function loadCalendarData(): Promise<CalendarPost[]> {
  try {
    const { rows } = await query<CalendarPost>(
      `SELECT cg.id AS cg_id, cg.status, cg.scheduled_at,
              p.posted_at, p.platform_id,
              substring(p.body, 1, 120) AS body_preview,
              t.name AS topic_name, t.color AS topic_color,
              cp.name AS pillar_name
         FROM content_groups cg
         JOIN posts p ON p.content_group_id = cg.id
         LEFT JOIN topics t ON t.id = cg.topic_id
         LEFT JOIN content_pillars cp ON cp.topic_id = cg.topic_id
        WHERE cg.status IN ('scheduled', 'ready', 'posted', 'queued')
          AND (cg.scheduled_at IS NOT NULL OR p.posted_at IS NOT NULL)
        ORDER BY COALESCE(cg.scheduled_at, p.posted_at) DESC
        LIMIT 200`,
    );
    return rows;
  } catch {
    return [];
  }
}

async function loadPillars() {
  try {
    const { rows } = await query<{
      name: string;
      slug: string;
      day_of_week: number | null;
      color: string | null;
      target_platform: string | null;
    }>(`SELECT name, slug, day_of_week, color, target_platform FROM content_pillars WHERE enabled = true ORDER BY sort_order`);
    return rows;
  } catch {
    return [];
  }
}

export default async function CalendarPage() {
  const [posts, pillars] = await Promise.all([loadCalendarData(), loadPillars()]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="bs-label">Calendar</div>
          <h1 className="text-2xl font-semibold text-[var(--text)] mt-1">Content calendar</h1>
          <p className="text-sm text-[var(--text-dim)] mt-1">
            {posts.length} scheduled + posted items
          </p>
        </div>
        <Link href="/" className="bs-btn">Queue view</Link>
      </div>

      {pillars.length > 0 && (
        <div className="bs-card p-4 mb-6">
          <div className="bs-label mb-2">Content pillars (publishing rhythm)</div>
          <div className="flex flex-wrap gap-3">
            {pillars.map((p) => {
              const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
              return (
                <div key={p.slug} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full" style={{ background: p.color ?? 'var(--accent)' }} />
                  <span className="text-[var(--text)]">{p.name}</span>
                  {p.day_of_week !== null && (
                    <span className="bs-pill font-mono">{days[p.day_of_week]}</span>
                  )}
                  {p.target_platform && (
                    <span className="bs-pill">{p.target_platform}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CalendarGrid posts={posts} />
    </div>
  );
}
