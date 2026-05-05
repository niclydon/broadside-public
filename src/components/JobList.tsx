'use client';

import { useEffect, useState } from 'react';

interface Job {
  id: string;
  kind: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  progress_current: number | null;
  progress_total: number | null;
  progress_label: string | null;
  result: unknown;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

const STATUS_COLOR: Record<Job['status'], string> = {
  pending: '#6b6b7a',
  running: '#5aadf0',
  done: '#4ade80',
  failed: '#e5484d',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function ProgressBar({ cur, total }: { cur: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((cur / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: 'var(--accent)' }}
        />
      </div>
      <span className="font-mono tabular-nums text-xs text-[var(--text-dim)] w-10 text-right">
        {pct}%
      </span>
    </div>
  );
}

export function JobList({ initialJobs, focusId }: { initialJobs: Job[]; focusId?: string }) {
  const [jobs, setJobs] = useState(initialJobs);

  // Poll every 2s if any job is running
  useEffect(() => {
    const anyRunning = jobs.some((j) => j.status === 'running' || j.status === 'pending');
    if (!anyRunning && !focusId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/jobs');
        if (res.ok) {
          const data = await res.json();
          setJobs(data.jobs);
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobs, focusId]);

  if (jobs.length === 0) {
    return (
      <div className="bs-card p-8 text-center text-[var(--muted)] italic">
        No jobs yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {jobs.map((j) => {
        const isFocused = focusId === j.id;
        const startedAt = j.started_at ? new Date(j.started_at).getTime() : null;
        const finishedAt = j.finished_at
          ? new Date(j.finished_at).getTime()
          : j.status === 'running'
          ? Date.now()
          : null;
        const dur = startedAt && finishedAt ? finishedAt - startedAt : null;
        const cur = j.progress_current ?? 0;
        const total = j.progress_total ?? 0;

        return (
          <div
            key={j.id}
            className="bs-card p-4"
            style={isFocused ? { borderColor: 'var(--accent)' } : undefined}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: STATUS_COLOR[j.status] }}
                />
                <span className="font-mono text-sm text-[var(--text)]">{j.kind}</span>
                <span className="bs-pill">{j.status}</span>
              </div>
              <div className="text-[0.6875rem] text-[var(--muted)] font-mono">
                {dur !== null ? formatDuration(dur) : '…'}
              </div>
            </div>

            {(j.status === 'running' || j.status === 'pending') && total > 0 && (
              <div className="mb-2">
                <ProgressBar cur={cur} total={total} />
                {j.progress_label && (
                  <div className="text-[0.6875rem] text-[var(--muted)] mt-1 font-mono">
                    {j.progress_label}
                  </div>
                )}
              </div>
            )}

            {j.status === 'done' && j.result !== null && (
              <details className="mt-2">
                <summary className="text-[0.6875rem] text-[var(--muted)] cursor-pointer">result</summary>
                <pre className="mt-2 text-[0.6875rem] font-mono bg-[var(--bg)] rounded p-2 overflow-x-auto text-[var(--text)]">
                  {JSON.stringify(j.result, null, 2)}
                </pre>
              </details>
            )}

            {j.status === 'failed' && j.error && (
              <div className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>
                {j.error}
              </div>
            )}

            <div className="mt-2 text-[0.6875rem] text-[var(--muted)] font-mono">
              {j.id.slice(0, 8)} · {new Date(j.created_at).toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
