'use client';

import { useState, useTransition, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Candidate {
  id: string;
  generation_id: string;
  topic_slug: string | null;
  hook: string | null;
  body: string;
  rationale: string | null;
  cited_item_ids: string[];
  accepted: boolean;
  rejected: boolean;
  content_group_id: string | null;
  created_at: string;
  generation_model: string | null;
  generation_cost: string | null;
}

const MODEL_LABELS: Record<string, { short: string; color: string }> = {
  'claude-opus-4-6':  { short: 'Opus',     color: '#d4a853' },
  'gpt-4o':           { short: 'GPT-4o',   color: '#4ade80' },
  'gemini-2.5-pro':   { short: 'Gemini',   color: '#5aadf0' },
  'deepseek-chat':    { short: 'DeepSeek', color: '#a78bfa' },
  'grok-3':           { short: 'Grok',     color: '#f472b6' },
};

const PROVIDERS = [
  { id: 'anthropic', label: 'Opus' },
  { id: 'openai', label: 'GPT-4o' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'grok', label: 'Grok' },
];

const PLATFORMS = [
  { id: 'twitter', label: 'X / Twitter (280)', desc: '280 chars' },
  { id: 'bluesky', label: 'Bluesky (300)', desc: '300 chars' },
  { id: 'linkedin', label: 'LinkedIn (3000)', desc: '3000 chars' },
  { id: 'substack', label: 'Substack (essay)', desc: 'essays' },
  { id: 'devto', label: 'Dev.to (article)', desc: 'technical blog' },
  { id: 'linkedin-article', label: 'LinkedIn Article', desc: 'long-form' },
];

function parsePlatformAndTitle(rationale: string | null): { platform: string; title: string | null; cleanRationale: string } {
  if (!rationale) return { platform: 'linkedin', title: null, cleanRationale: '' };
  const match = rationale.match(/^\[(\w+)(?:\s*\|\s*"([^"]+)")?\]\s*(.*)$/s);
  if (!match) return { platform: 'linkedin', title: null, cleanRationale: rationale };
  return { platform: match[1], title: match[2] ?? null, cleanRationale: match[3] ?? '' };
}

const PLATFORM_LIMITS: Record<string, number> = { linkedin: 3000, bluesky: 300, twitter: 280 };

type SortField = 'date' | 'model' | 'platform' | 'topic' | 'length';

export function SuggestionsInbox({ initialCandidates }: { initialCandidates: Candidate[] }) {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [generating, startGenerate] = useTransition();
  const [genError, setGenError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  const [jobStatus, setJobStatus] = useState<{ label: string; pct: number } | null>(null);
  const router = useRouter();

  // Filters
  const [filterModel, setFilterModel] = useState<string>('all');
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [filterTopic, setFilterTopic] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortField>('date');

  // Generation options
  const [genProvider, setGenProvider] = useState('anthropic');
  const [genPlatform, setGenPlatform] = useState<string>('');
  const [genCount, setGenCount] = useState(5);
  const [genPrompt, setGenPrompt] = useState('');

  const refreshCandidates = async () => {
    const res = await fetch('/api/drafts/candidates?status=pending&limit=500');
    if (res.ok) {
      const data = await res.json();
      setCandidates(data.candidates);
    }
  };

  useEffect(() => {
    if (!activeJobId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/jobs/${activeJobId}`);
      if (!res.ok) return;
      const { job } = await res.json();
      const total = job.progress_total ?? 100;
      const cur = job.progress_current ?? 0;
      setJobStatus({ label: job.progress_label ?? job.status, pct: total > 0 ? Math.round((cur / total) * 100) : 0 });
      if (job.status === 'done') {
        setActiveJobId(null);
        setJobStatus(null);
        await refreshCandidates();
        router.refresh();
      } else if (job.status === 'failed') {
        setActiveJobId(null);
        setJobStatus(null);
        setGenError(job.error ?? 'generation failed');
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [activeJobId, router]);

  const generate = () => {
    setGenError(null);
    startGenerate(async () => {
      const body: Record<string, unknown> = {
        count: genCount,
        provider: genProvider,
        mode: 'on_demand',
      };
      if (genPlatform) body.target_platform = genPlatform;
      if (genPrompt.trim()) body.topic_hint = genPrompt.trim();
      const res = await fetch('/api/drafts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'unknown' }));
        setGenError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const { job_id } = await res.json();
      setActiveJobId(job_id);
    });
  };

  // Multi-job polling for "Generate All"
  useEffect(() => {
    if (activeJobIds.length === 0) return;
    const interval = setInterval(async () => {
      const results = await Promise.all(
        activeJobIds.map(async (jid) => {
          const res = await fetch(`/api/jobs/${jid}`);
          if (!res.ok) return { id: jid, status: 'unknown', pct: 0, label: '' };
          const { job } = await res.json();
          const total = job.progress_total ?? 100;
          const cur = job.progress_current ?? 0;
          return { id: jid, status: job.status, pct: total > 0 ? Math.round((cur / total) * 100) : 0, label: job.progress_label ?? job.status, error: job.error };
        }),
      );
      const done = results.filter((r) => r.status === 'done').length;
      const failed = results.filter((r) => r.status === 'failed').length;
      const total = results.length;
      const avgPct = Math.round(results.reduce((s, r) => s + r.pct, 0) / total);
      setJobStatus({ label: `${done}/${total} models complete${failed ? ` (${failed} failed)` : ''}`, pct: avgPct });
      if (done + failed >= total) {
        setActiveJobIds([]);
        setJobStatus(null);
        if (failed > 0) {
          const errors = results.filter((r) => r.status === 'failed').map((r) => r.error).join('; ');
          setGenError(`${failed}/${total} providers failed: ${errors}`);
        }
        await refreshCandidates();
        router.refresh();
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [activeJobIds, router]);

  const generateAll = async () => {
    setGenError(null);
    const jobIds: string[] = [];
    for (const provider of PROVIDERS) {
      const body: Record<string, unknown> = {
        count: genCount,
        provider: provider.id,
        mode: 'on_demand',
      };
      if (genPlatform) body.target_platform = genPlatform;
      if (genPrompt.trim()) body.topic_hint = genPrompt.trim();
      const res = await fetch('/api/drafts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const { job_id } = await res.json();
        jobIds.push(job_id);
      }
    }
    if (jobIds.length > 0) setActiveJobIds(jobIds);
  };

  const accept = async (id: string) => {
    const res = await fetch(`/api/drafts/candidates/${id}/accept`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? `accept failed: HTTP ${res.status}`);
      return;
    }
    const { content_group_id } = await res.json();
    router.push(`/posts/${content_group_id}`);
    router.refresh();
  };

  const reject = async (id: string) => {
    const res = await fetch(`/api/drafts/candidates/${id}/reject`, { method: 'POST' });
    if (res.ok) {
      setCandidates((cur) => cur.filter((c) => c.id !== id));
      router.refresh();
    }
  };

  // Derive unique values for filter dropdowns
  const allModels = useMemo(() => [...new Set(candidates.map((c) => c.generation_model).filter(Boolean))], [candidates]);
  const allTopics = useMemo(() => [...new Set(candidates.map((c) => c.topic_slug).filter(Boolean))], [candidates]);
  const allPlatforms = useMemo(() => {
    return [...new Set(candidates.map((c) => parsePlatformAndTitle(c.rationale).platform))];
  }, [candidates]);

  // Apply filters + sort
  const filtered = useMemo(() => {
    let result = candidates;
    if (filterModel !== 'all') result = result.filter((c) => c.generation_model === filterModel);
    if (filterPlatform !== 'all') result = result.filter((c) => parsePlatformAndTitle(c.rationale).platform === filterPlatform);
    if (filterTopic !== 'all') result = result.filter((c) => c.topic_slug === filterTopic);

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'model': return (a.generation_model ?? '').localeCompare(b.generation_model ?? '');
        case 'platform': return parsePlatformAndTitle(a.rationale).platform.localeCompare(parsePlatformAndTitle(b.rationale).platform);
        case 'topic': return (a.topic_slug ?? '').localeCompare(b.topic_slug ?? '');
        case 'length': return b.body.length - a.body.length;
        default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return result;
  }, [candidates, filterModel, filterPlatform, filterTopic, sortBy]);

  return (
    <div>
      {/* Generation controls */}
      <div className="bs-card p-4 mb-6">
        <div className="bs-label mb-3">Generate new candidates</div>
        <div className="mb-3">
          <label className="text-[0.6875rem] text-[var(--muted)] block mb-1">Prompt (optional)</label>
          <textarea
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            placeholder='Topic hint — e.g., "local inference cost analysis" or "how I built this workflow"'
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm font-sans min-h-[60px] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto_auto] gap-3 items-end">
          <div>
            <label className="text-[0.6875rem] text-[var(--muted)] block mb-1">Model</label>
            <select
              value={genProvider}
              onChange={(e) => setGenProvider(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm focus:outline-none focus:border-[var(--accent)]"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[0.6875rem] text-[var(--muted)] block mb-1">Platform</label>
            <select
              value={genPlatform}
              onChange={(e) => setGenPlatform(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="">Auto (mixed)</option>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[0.6875rem] text-[var(--muted)] block mb-1">Count</label>
            <select
              value={genCount}
              onChange={(e) => setGenCount(parseInt(e.target.value, 10))}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm focus:outline-none focus:border-[var(--accent)]"
            >
              {[3, 5, 10].map((n) => (
                <option key={n} value={n}>{n} drafts</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="bs-btn bs-btn-primary h-[38px]"
            onClick={generate}
            disabled={generating || activeJobId !== null || activeJobIds.length > 0}
          >
            {generating || activeJobId ? 'Generating…' : 'Generate'}
          </button>
          <button
            type="button"
            className="bs-btn h-[38px]"
            onClick={generateAll}
            disabled={generating || activeJobId !== null || activeJobIds.length > 0}
            title={`Generate ${genCount} drafts × ${PROVIDERS.length} models = ${genCount * PROVIDERS.length} total`}
          >
            {activeJobIds.length > 0 ? 'All running…' : `All models (${genCount * PROVIDERS.length})`}
          </button>
        </div>
        {jobStatus && (
          <div className="mt-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${jobStatus.pct}%`, background: 'var(--accent)' }} />
              </div>
              <span className="font-mono tabular-nums text-xs text-[var(--text-dim)] w-10 text-right">{jobStatus.pct}%</span>
            </div>
            <div className="text-[0.6875rem] text-[var(--muted)] font-mono mt-1">{jobStatus.label}</div>
          </div>
        )}
        {genError && <div className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{genError}</div>}
      </div>

      {/* Filters + sort */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-[0.6875rem] text-[var(--muted)]">Filter:</span>
          <select value={filterModel} onChange={(e) => setFilterModel(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--accent)]">
            <option value="all">All models</option>
            {allModels.map((m) => {
              const info = MODEL_LABELS[m!] ?? { short: m };
              return <option key={m} value={m!}>{info.short}</option>;
            })}
          </select>
          <select value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--accent)]">
            <option value="all">All platforms</option>
            {allPlatforms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filterTopic} onChange={(e) => setFilterTopic(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--accent)]">
            <option value="all">All topics</option>
            {allTopics.map((t) => <option key={t} value={t!}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[0.6875rem] text-[var(--muted)]">Sort:</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortField)} className="rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--accent)]">
            <option value="date">Newest first</option>
            <option value="model">By model</option>
            <option value="platform">By platform</option>
            <option value="topic">By topic</option>
            <option value="length">By length</option>
          </select>
        </div>
        <span className="text-[0.6875rem] text-[var(--muted)] font-mono tabular-nums">
          {filtered.length}/{candidates.length}
        </span>
      </div>

      {/* Candidates */}
      {filtered.length === 0 ? (
        <div className="bs-card p-8 text-center text-[var(--muted)] italic">
          {candidates.length === 0 ? 'No pending candidates. Generate some above.' : 'No candidates match the current filters.'}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((c) => {
            const { platform, title, cleanRationale } = parsePlatformAndTitle(c.rationale);
            const limit = PLATFORM_LIMITS[platform] ?? 0;
            const bodyLen = c.body.length;
            const over = limit > 0 && bodyLen > limit;
            const modelInfo = c.generation_model ? MODEL_LABELS[c.generation_model] ?? { short: c.generation_model, color: 'var(--muted)' } : null;

            return (
              <div key={c.id} className="bs-card p-5">
                <div className="flex items-center gap-2 mb-3 text-[0.6875rem]">
                  <span className="bs-pill font-mono uppercase">{platform}</span>
                  {modelInfo && (
                    <span className="bs-pill font-mono" style={{ color: modelInfo.color, borderColor: modelInfo.color + '40' }}>
                      {modelInfo.short}
                    </span>
                  )}
                  {c.topic_slug && (
                    <span className="bs-pill" style={{ color: 'var(--accent)' }}>{c.topic_slug}</span>
                  )}
                  <span className="text-[var(--muted)]">{new Date(c.created_at).toLocaleString()}</span>
                  <span className="font-mono tabular-nums ml-auto" style={{ color: over ? 'var(--danger)' : 'var(--muted)' }}>
                    {bodyLen}{limit > 0 ? `/${limit}` : ''}
                  </span>
                </div>

                {title && <div className="font-serif text-lg text-[var(--text)] mb-2 italic">{title}</div>}

                <div className="text-sm text-[var(--text)] whitespace-pre-wrap leading-relaxed font-sans mb-4">
                  {c.body}
                </div>

                {cleanRationale && (
                  <details className="mb-3">
                    <summary className="bs-label cursor-pointer">rationale</summary>
                    <p className="text-xs text-[var(--text-dim)] italic mt-1">{cleanRationale}</p>
                  </details>
                )}

                <div className="flex gap-2 justify-end">
                  <button type="button" className="bs-btn" onClick={() => navigator.clipboard.writeText(c.body).catch(() => {})}>Copy</button>
                  <button type="button" className="bs-btn" onClick={() => reject(c.id)}>Reject</button>
                  <button type="button" className="bs-btn bs-btn-primary" onClick={() => accept(c.id)}>Accept & edit</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
