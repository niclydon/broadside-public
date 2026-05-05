'use client';

import { useState } from 'react';

interface ReviewSuggestion {
  location: string;
  current: string;
  suggested: string;
  rationale: string;
}

interface ReviewData {
  assessment: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: ReviewSuggestion[];
  score: number;
}

interface ReviewResponse {
  review: ReviewData;
  provider: string;
  model: string;
  cost_usd: number;
  tokens: { input: number; output: number };
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

interface Props {
  postId: string;
  body: string;
  title?: string | null;
  platform: string;
  hashtags?: string[];
  onUpdateBody?: (newBody: string) => void;
  onUpdateTitle?: (newTitle: string) => void;
}

export function PostReview({ postId, body, title, platform, hashtags, onUpdateBody, onUpdateTitle }: Props) {
  const [provider, setProvider] = useState('anthropic');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResponse | null>(null);
  const [applied, setApplied] = useState<Set<number>>(new Set());

  const applySuggestion = (index: number, suggestion: ReviewSuggestion) => {
    if (!onUpdateBody || applied.has(index)) return;
    // Try exact substring match in body
    if (body.includes(suggestion.current)) {
      onUpdateBody(body.replace(suggestion.current, suggestion.suggested));
      setApplied((prev) => new Set(prev).add(index));
    } else if (title && title.includes(suggestion.current) && onUpdateTitle) {
      onUpdateTitle(title.replace(suggestion.current, suggestion.suggested));
      setApplied((prev) => new Set(prev).add(index));
    } else {
      // No exact match — copy suggested text to clipboard as fallback
      navigator.clipboard.writeText(suggestion.suggested).catch(() => {});
      setApplied((prev) => new Set(prev).add(index));
    }
  };

  const applyAll = () => {
    if (!onUpdateBody || !result) return;
    let currentBody = body;
    let currentTitle = title ?? '';
    const nowApplied = new Set(applied);
    for (let i = 0; i < result.review.suggestions.length; i++) {
      if (nowApplied.has(i)) continue;
      const s = result.review.suggestions[i];
      if (currentBody.includes(s.current)) {
        currentBody = currentBody.replace(s.current, s.suggested);
        nowApplied.add(i);
      } else if (currentTitle && currentTitle.includes(s.current) && onUpdateTitle) {
        currentTitle = currentTitle.replace(s.current, s.suggested);
        nowApplied.add(i);
      }
    }
    onUpdateBody(currentBody);
    if (onUpdateTitle && currentTitle !== (title ?? '')) onUpdateTitle(currentTitle);
    setApplied(nowApplied);
  };

  const canMatch = (suggestion: ReviewSuggestion): boolean => {
    return body.includes(suggestion.current) || (!!title && title.includes(suggestion.current));
  };

  const runReview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          title: title || null,
          platform,
          hashtags: hashtags ?? [],
          provider,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'unknown' }));
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data: ReviewResponse = await res.json();
      setResult(data);
      setApplied(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="bs-label">LLM Review</div>
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
          disabled={loading || !body.trim()}
        >
          {loading ? 'Reviewing…' : 'Review'}
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
          <span className="text-sm text-[var(--muted)]">Getting honest feedback from {PROVIDERS.find((p) => p.id === provider)?.label}…</span>
        </div>
      )}

      {error && (
        <div className="text-xs mb-3" style={{ color: 'var(--danger)' }}>{error}</div>
      )}

      {result && !loading && (
        <div className="bs-card p-5">
          {/* Score + model header */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className="text-3xl font-semibold font-mono tabular-nums"
              style={{ color: scoreColor(result.review.score) }}
            >
              {result.review.score}/10
            </div>
            <span
              className="bs-pill font-mono"
              style={{ color: MODEL_COLORS[result.model] ?? 'var(--muted)', borderColor: (MODEL_COLORS[result.model] ?? 'var(--muted)') + '40' }}
            >
              {result.model}
            </span>
          </div>

          {/* Assessment */}
          <p className="text-sm text-[var(--text)] leading-relaxed mb-4">
            {result.review.assessment}
          </p>

          {/* Strengths */}
          {result.review.strengths.length > 0 && (
            <div className="mb-4">
              <div className="text-[0.6875rem] text-[#4ade80] uppercase tracking-wider font-semibold mb-2">Strengths</div>
              <ul className="flex flex-col gap-1">
                {result.review.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-[var(--text-dim)] flex gap-2">
                    <span className="text-[#4ade80] flex-shrink-0">+</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Weaknesses */}
          {result.review.weaknesses.length > 0 && (
            <div className="mb-4">
              <div className="text-[0.6875rem] text-[#f97316] uppercase tracking-wider font-semibold mb-2">Weaknesses</div>
              <ul className="flex flex-col gap-1">
                {result.review.weaknesses.map((w, i) => (
                  <li key={i} className="text-xs text-[var(--text-dim)] flex gap-2">
                    <span className="text-[#f97316] flex-shrink-0">−</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {result.review.suggestions.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="text-[0.6875rem] text-[var(--accent)] uppercase tracking-wider font-semibold">
                  Suggested changes ({result.review.suggestions.length})
                </div>
                {onUpdateBody && applied.size < result.review.suggestions.length && (
                  <button
                    type="button"
                    className="bs-btn text-[0.625rem] py-0.5 px-2"
                    onClick={applyAll}
                  >
                    Apply all matchable
                  </button>
                )}
                {applied.size > 0 && (
                  <span className="text-[0.625rem] text-[#4ade80] font-mono">
                    {applied.size}/{result.review.suggestions.length} applied
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {result.review.suggestions.map((s, i) => {
                  const isApplied = applied.has(i);
                  const matchable = canMatch(s);
                  return (
                    <div
                      key={i}
                      className="rounded border p-3 transition-colors"
                      style={{ borderColor: isApplied ? '#4ade8040' : 'var(--border)' }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[0.625rem] text-[var(--muted)] uppercase tracking-wider">
                          {s.location}
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="text-[0.5625rem] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                            onClick={() => navigator.clipboard.writeText(s.suggested).catch(() => {})}
                          >
                            Copy
                          </button>
                          {onUpdateBody && (
                            <button
                              type="button"
                              className="text-[0.5625rem] px-1.5 py-0.5 rounded border transition-colors"
                              style={{
                                borderColor: isApplied ? '#4ade8040' : 'var(--accent)',
                                color: isApplied ? '#4ade80' : 'var(--accent)',
                                opacity: isApplied ? 0.7 : 1,
                              }}
                              disabled={isApplied}
                              onClick={() => applySuggestion(i, s)}
                              title={isApplied ? 'Applied' : matchable ? 'Replace in editor' : 'No exact match — will copy suggested text'}
                            >
                              {isApplied ? 'Applied' : matchable ? 'Apply' : 'Apply (copy)'}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                        <div>
                          <div className="text-[0.5625rem] text-[#f97316] uppercase mb-0.5">Current</div>
                          <div className="text-xs text-[var(--text-dim)] bg-[var(--bg)] rounded p-2 font-mono leading-relaxed">
                            {s.current}
                          </div>
                        </div>
                        <div>
                          <div className="text-[0.5625rem] text-[#4ade80] uppercase mb-0.5">Suggested</div>
                          <div className="text-xs text-[var(--text)] bg-[var(--bg)] rounded p-2 font-mono leading-relaxed">
                            {s.suggested}
                          </div>
                        </div>
                      </div>
                      <p className="text-[0.6875rem] text-[var(--muted)] italic">{s.rationale}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
