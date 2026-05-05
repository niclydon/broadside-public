'use client';

import { useState, useEffect, useCallback } from 'react';

interface VoiceSample {
  id: string;
  platform_id: string | null;
  body: string;
  is_published: boolean;
  excluded: boolean;
  source: string | null;
  notes: string | null;
  created_at: string;
}

interface Stats {
  total: number;
  active: number;
  excluded: number;
  avgLength: number;
  platforms: string[];
}

export function VoiceCuration({ initialStats }: { initialStats: Stats }) {
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [stats, setStats] = useState(initialStats);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'excluded'>('active');
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [sort, setSort] = useState<'length' | 'date'>('length');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchSamples = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: filter, sort });
    if (platformFilter) params.set('platform', platformFilter);
    const res = await fetch(`/api/voice?${params}`);
    const data = await res.json();
    setSamples(data.samples);
    setStats(data.stats);
    setLoading(false);
  }, [filter, platformFilter, sort]);

  useEffect(() => { fetchSamples(); }, [fetchSamples]);

  async function toggleExcluded(id: string, excluded: boolean) {
    await fetch(`/api/voice/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excluded }),
    });
    fetchSamples();
  }

  async function deleteSample(id: string) {
    if (!confirm('Permanently delete this voice sample?')) return;
    await fetch(`/api/voice/${id}`, { method: 'DELETE' });
    fetchSamples();
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1">
          {(['active', 'excluded', 'all'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                filter === s
                  ? 'bg-[var(--accent)] text-[var(--bg)] font-medium'
                  : 'bg-[var(--surface)] text-[var(--text-dim)] hover:text-[var(--text)] border border-[var(--border)]'
              }`}
            >
              {s === 'active' ? `Active (${stats.active})` : s === 'excluded' ? `Excluded (${stats.excluded})` : `All (${stats.total})`}
            </button>
          ))}
        </div>

        <select
          value={platformFilter}
          onChange={e => setPlatformFilter(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)]"
        >
          <option value="">All platforms</option>
          {initialStats.platforms.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <select
          value={sort}
          onChange={e => setSort(e.target.value as 'length' | 'date')}
          className="text-xs px-2 py-1.5 rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)]"
        >
          <option value="length">Longest first</option>
          <option value="date">Newest first</option>
        </select>

        <span className="text-xs text-[var(--muted)] ml-auto">
          {samples.length} shown
        </span>
      </div>

      {/* Sample list */}
      {loading ? (
        <div className="text-sm text-[var(--muted)] py-8 text-center">Loading samples...</div>
      ) : samples.length === 0 ? (
        <div className="bs-card p-8 text-center text-sm text-[var(--muted)]">No samples match the current filters.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {samples.map(sample => {
            const isExpanded = expanded.has(sample.id);
            const preview = sample.body.length > 200
              ? sample.body.slice(0, 200) + '...'
              : sample.body;

            return (
              <div
                key={sample.id}
                className={`bs-card p-3 transition-colors ${sample.excluded ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start gap-3">
                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => toggleExpand(sample.id)}
                      className="text-left w-full"
                    >
                      <p className="text-sm text-[var(--text)] whitespace-pre-wrap break-words">
                        {isExpanded ? sample.body : preview}
                      </p>
                    </button>
                    <div className="flex items-center gap-3 mt-2 text-xs text-[var(--muted)]">
                      {sample.platform_id && (
                        <span className="bs-pill font-mono">{sample.platform_id}</span>
                      )}
                      <span>{sample.body.length} chars</span>
                      {sample.source && <span>{sample.source}</span>}
                      {sample.body.length <= 300 && (
                        <span className="text-yellow-500">below prompt threshold</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleExcluded(sample.id, !sample.excluded)}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
                      title={sample.excluded ? 'Include in voice prompt' : 'Exclude from voice prompt'}
                    >
                      {sample.excluded ? 'Include' : 'Exclude'}
                    </button>
                    <button
                      onClick={() => deleteSample(sample.id)}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:border-red-500 text-[var(--text-dim)] hover:text-red-400 transition-colors"
                      title="Delete permanently"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
