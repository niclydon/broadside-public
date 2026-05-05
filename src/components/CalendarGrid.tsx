'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

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

const STATUS_COLOR: Record<string, string> = {
  scheduled: '#a78bfa',
  ready: '#fbbf24',
  posted: '#4ade80',
  queued: '#5aadf0',
};

const PLATFORM_EMOJI: Record<string, string> = {
  linkedin: 'LI',
  bluesky: 'BS',
  twitter: 'X',
  substack: 'SS',
};

function getWeekDays(weekOffset: number): Date[] {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function CalendarGrid({ posts }: { posts: CalendarPost[] }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const days = useMemo(() => getWeekDays(weekOffset), [weekOffset]);
  const today = new Date();

  const postsByDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const p of posts) {
      const dateStr = p.scheduled_at ?? p.posted_at;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [posts]);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthYear = days[3].toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button type="button" className="bs-btn" onClick={() => setWeekOffset((w) => w - 1)}>← Prev</button>
        <div className="text-sm text-[var(--text)]">{monthYear}</div>
        <div className="flex gap-2">
          {weekOffset !== 0 && (
            <button type="button" className="bs-btn" onClick={() => setWeekOffset(0)}>Today</button>
          )}
          <button type="button" className="bs-btn" onClick={() => setWeekOffset((w) => w + 1)}>Next →</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
          const dayPosts = postsByDay.get(key) ?? [];
          const isToday = isSameDay(day, today);

          return (
            <div
              key={i}
              className="bs-card min-h-[140px] p-2 flex flex-col"
              style={isToday ? { borderColor: 'var(--accent)' } : undefined}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-mono ${isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--muted)]'}`}>
                  {dayNames[i]}
                </span>
                <span className={`text-sm tabular-nums ${isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-dim)]'}`}>
                  {day.getDate()}
                </span>
              </div>
              <div className="flex flex-col gap-1 flex-1">
                {dayPosts.map((p, j) => (
                  <Link
                    key={j}
                    href={`/posts/${p.cg_id}`}
                    className="block rounded px-1.5 py-1 text-[0.625rem] leading-tight hover:brightness-125 transition-all truncate"
                    style={{
                      background: (STATUS_COLOR[p.status] ?? 'var(--border)') + '20',
                      borderLeft: `2px solid ${p.topic_color ?? STATUS_COLOR[p.status] ?? 'var(--border)'}`,
                      color: 'var(--text-dim)',
                    }}
                  >
                    <span className="font-mono text-[0.5625rem] mr-1" style={{ color: 'var(--muted)' }}>
                      {PLATFORM_EMOJI[p.platform_id] ?? p.platform_id}
                    </span>
                    {p.body_preview.slice(0, 50)}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
