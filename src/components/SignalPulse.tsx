'use client';

import { useState, useEffect, useCallback } from 'react';

interface TopicPulse {
  slug: string;
  name: string;
  color: string | null;
  signal_count: number;
  by_source: Record<string, number>;
  trend: 'up' | 'down' | 'steady' | 'new';
  prev_period_count: number;
  top_signals: Array<{
    title: string;
    source: string;
    score: number;
    url: string | null;
    occurred_at: string;
  }>;
}

interface PulseData {
  window_days: number;
  topics: TopicPulse[];
  total_signals: number;
}

const SOURCE_LABELS: Record<string, string> = {
  hackernews: 'HN',
  arxiv: 'arXiv',
  rss: 'RSS',
  bluesky: 'Bluesky',
};

const TREND_ICONS: Record<string, { icon: string; color: string }> = {
  up: { icon: '↑', color: '#4ade80' },
  down: { icon: '↓', color: '#f97316' },
  steady: { icon: '→', color: '#6b6b7a' },
  new: { icon: '★', color: '#fbbf24' },
};

export function SignalPulse() {
  const [data, setData] = useState<PulseData | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/signals/pulse?days=${days}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="bs-card p-4">
        <div className="bs-label mb-2">Topic pulse</div>
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <div className="w-3 h-3 border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
          Loading signals…
        </div>
      </div>
    );
  }

  if (!data || data.total_signals === 0) {
    return (
      <div className="bs-card p-4">
        <div className="bs-label mb-2">Topic pulse</div>
        <p className="text-xs text-[var(--muted)]">
          No external signals with topic scores yet. Run a sync to populate.
        </p>
      </div>
    );
  }

  const maxCount = Math.max(...data.topics.map((t) => t.signal_count), 1);

  return (
    <div className="bs-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="bs-label">Topic pulse</div>
        <span className="text-[0.625rem] text-[var(--muted)] font-mono">{data.total_signals} signals</span>
        <div className="flex gap-1 ml-auto">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              className="text-[0.5625rem] px-1.5 py-0.5 rounded border transition-colors"
              style={{
                borderColor: days === d ? 'var(--accent)' : 'var(--border)',
                color: days === d ? 'var(--accent)' : 'var(--muted)',
              }}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {data.topics.map((topic) => {
          const trend = TREND_ICONS[topic.trend];
          const barWidth = maxCount > 0 ? Math.max((topic.signal_count / maxCount) * 100, 2) : 0;
          const sourceEntries = Object.entries(topic.by_source).sort((a, b) => b[1] - a[1]);

          return (
            <details key={topic.slug}>
              <summary className="flex items-center gap-2 cursor-pointer hover:bg-[var(--surface-2)] rounded p-1.5 transition-colors">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: topic.color ?? 'var(--muted)' }} />
                <span className="text-xs text-[var(--text)] font-medium w-36 flex-shrink-0">{topic.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${barWidth}%`, background: topic.color ?? 'var(--accent)', opacity: 0.7 }}
                  />
                </div>
                <span className="font-mono text-[0.625rem] tabular-nums text-[var(--text-dim)] w-8 text-right">
                  {topic.signal_count}
                </span>
                <span className="text-[0.625rem] w-4" style={{ color: trend.color }}>{trend.icon}</span>
              </summary>

              <div className="pl-5 pb-2">
                {/* Source breakdown */}
                {sourceEntries.length > 0 && (
                  <div className="flex gap-2 mt-1 mb-2">
                    {sourceEntries.map(([src, count]) => (
                      <span key={src} className="text-[0.5625rem] text-[var(--muted)]">
                        {count} {SOURCE_LABELS[src] ?? src}
                      </span>
                    ))}
                  </div>
                )}

                {/* Top signals */}
                {topic.top_signals.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {topic.top_signals.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-[0.625rem]">
                        <span className="bs-pill text-[0.5rem]">{SOURCE_LABELS[s.source] ?? s.source}</span>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--text-dim)] hover:text-[var(--accent)] truncate flex-1">
                            {s.title}
                          </a>
                        ) : (
                          <span className="text-[var(--text-dim)] truncate flex-1">{s.title}</span>
                        )}
                        <span className="text-[var(--muted)] font-mono tabular-nums flex-shrink-0">{s.score.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
