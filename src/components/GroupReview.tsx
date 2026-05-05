'use client';

import { useState } from 'react';

interface Suggestion {
  location: string;
  current: string;
  suggested: string;
  rationale: string;
}

interface PlatformReview {
  platform: string;
  score: number;
  assessment: string;
  suggestions: Suggestion[];
}

interface GroupReviewData {
  overall_assessment: string;
  coherence_score: number;
  per_platform: PlatformReview[];
  cross_platform_suggestions: string[];
}

interface GroupReviewResponse {
  review: GroupReviewData;
  provider: string;
  model: string;
  cost_usd: number;
  tokens: { input: number; output: number };
}

interface PostInput {
  platform: string;
  title?: string | null;
  body: string;
  hashtags?: string[];
}

const PROVIDERS = [
  { id: 'anthropic', label: 'Opus' },
  { id: 'openai', label: 'GPT-4o' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'grok', label: 'Grok' },
];

const MODEL_COLORS: Record<string, string> = {
  'claude-opus-4-6': '#d4a853',
  'gpt-4o': '#4ade80',
  'gemini-2.5-pro': '#5aadf0',
  'deepseek-chat': '#a78bfa',
  'grok-3': '#f472b6',
};

function scoreColor(score: number): string {
  if (score >= 8) return '#4ade80';
  if (score >= 6) return '#fbbf24';
  if (score >= 4) return '#f97316';
  return '#ef4444';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Props {
  groupId: string;
  posts: PostInput[];
  onApplySuggestion?: (platform: string, current: string, suggested: string) => void;
}

export function GroupReview({ groupId, posts, onApplySuggestion }: Props) {
  const [provider, setProvider] = useState('anthropic');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GroupReviewResponse | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const runReview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-groups/${groupId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posts, provider }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'unknown' }));
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data: GroupReviewResponse = await res.json();
      setResult(data);
      setApplied(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = (platform: string, index: number, suggestion: Suggestion) => {
    const key = `${platform}-${index}`;
    if (applied.has(key)) return;
    if (onApplySuggestion) {
      onApplySuggestion(platform, suggestion.current, suggestion.suggested);
    }
    setApplied((prev) => new Set(prev).add(key));
  };

  const hasContent = posts.some((p) => p.body.trim().length > 0);

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="bs-label">Campaign Review</div>
        <span className="text-[0.625rem] text-[var(--muted)]">
          {posts.length} platform{posts.length !== 1 ? 's' : ''}
        </span>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          disabled={loading}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--accent)]"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="bs-btn bs-btn-primary text-xs"
          onClick={runReview}
          disabled={loading || !hasContent}
        >
          {loading ? 'Reviewing…' : 'Review campaign'}
        </button>
        {result && (
          <span className="text-[0.625rem] text-[var(--muted)] font-mono ml-auto">
            ${result.cost_usd.toFixed(4)} · {result.tokens.input + result.tokens.output} tokens
          </span>
        )}
      </div>

      {loading && (
        <div className="bs-card p-4 flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
          <span className="text-sm text-[var(--muted)]">
            Reviewing {posts.length} variants with {PROVIDERS.find((p) => p.id === provider)?.label}…
          </span>
        </div>
      )}

      {error && (
        <div className="text-xs mb-3" style={{ color: 'var(--danger)' }}>{error}</div>
      )}

      {result && !loading && (
        <div className="bs-card p-5">
          {/* Header: coherence score + model */}
          <div className="flex items-center gap-3 mb-4">
            <div className="text-3xl font-semibold font-mono tabular-nums" style={{ color: scoreColor(result.review.coherence_score) }}>
              {result.review.coherence_score}/10
            </div>
            <div className="flex flex-col">
              <span className="text-[0.625rem] text-[var(--muted)] uppercase tracking-wider">Coherence</span>
              <span
                className="bs-pill font-mono mt-0.5"
                style={{ color: MODEL_COLORS[result.model] ?? 'var(--muted)', borderColor: (MODEL_COLORS[result.model] ?? 'var(--muted)') + '40' }}
              >
                {result.model}
              </span>
            </div>
          </div>

          {/* Overall assessment */}
          <p className="text-sm text-[var(--text)] leading-relaxed mb-4">
            {result.review.overall_assessment}
          </p>

          {/* Cross-platform suggestions */}
          {result.review.cross_platform_suggestions.length > 0 && (
            <div className="mb-5">
              <div className="text-[0.6875rem] text-[var(--accent)] uppercase tracking-wider font-semibold mb-2">
                Cross-platform notes
              </div>
              <ul className="flex flex-col gap-1">
                {result.review.cross_platform_suggestions.map((s, i) => (
                  <li key={i} className="text-xs text-[var(--text-dim)] flex gap-2">
                    <span className="text-[var(--accent)] flex-shrink-0">→</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-platform reviews */}
          <div className="flex flex-col gap-4">
            {result.review.per_platform.map((pr) => (
              <details key={pr.platform} open className="rounded border border-[var(--border)]">
                <summary className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[var(--surface-2)] transition-colors">
                  <span className="font-mono text-sm font-medium text-[var(--text)]">{capitalize(pr.platform)}</span>
                  <span
                    className="font-mono text-sm font-semibold tabular-nums"
                    style={{ color: scoreColor(pr.score) }}
                  >
                    {pr.score}/10
                  </span>
                  <span className="text-xs text-[var(--text-dim)] flex-1">{pr.assessment.slice(0, 100)}{pr.assessment.length > 100 ? '…' : ''}</span>
                </summary>
                <div className="p-3 pt-0">
                  <p className="text-xs text-[var(--text-dim)] leading-relaxed mb-3">{pr.assessment}</p>

                  {pr.suggestions.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {pr.suggestions.map((s, i) => {
                        const key = `${pr.platform}-${i}`;
                        const isApplied = applied.has(key);
                        return (
                          <div
                            key={i}
                            className="rounded border p-2 transition-colors"
                            style={{ borderColor: isApplied ? '#4ade8040' : 'var(--border)' }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[0.5625rem] text-[var(--muted)] uppercase tracking-wider">{s.location}</span>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  className="text-[0.5625rem] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                                  onClick={() => navigator.clipboard.writeText(s.suggested).catch(() => {})}
                                >
                                  Copy
                                </button>
                                {onApplySuggestion && (
                                  <button
                                    type="button"
                                    className="text-[0.5625rem] px-1.5 py-0.5 rounded border transition-colors"
                                    style={{
                                      borderColor: isApplied ? '#4ade8040' : 'var(--accent)',
                                      color: isApplied ? '#4ade80' : 'var(--accent)',
                                      opacity: isApplied ? 0.7 : 1,
                                    }}
                                    disabled={isApplied}
                                    onClick={() => handleApply(pr.platform, i, s)}
                                  >
                                    {isApplied ? 'Applied' : 'Apply'}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-1">
                              <div>
                                <div className="text-[0.5rem] text-[#f97316] uppercase mb-0.5">Current</div>
                                <div className="text-[0.6875rem] text-[var(--text-dim)] bg-[var(--bg)] rounded p-1.5 font-mono leading-relaxed">{s.current}</div>
                              </div>
                              <div>
                                <div className="text-[0.5rem] text-[#4ade80] uppercase mb-0.5">Suggested</div>
                                <div className="text-[0.6875rem] text-[var(--text)] bg-[var(--bg)] rounded p-1.5 font-mono leading-relaxed">{s.suggested}</div>
                              </div>
                            </div>
                            <p className="text-[0.625rem] text-[var(--muted)] italic">{s.rationale}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
