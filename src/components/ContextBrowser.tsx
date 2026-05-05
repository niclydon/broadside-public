'use client';

import { useEffect, useState } from 'react';

interface ContextItem {
  id: string;
  kind: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
  occurred_at: string | null;
  ingested_at: string;
  source_kind: string;
  source_name: string;
  has_embedding: boolean;
}

const KINDS = [
  'all',
  'readme',
  'claude_md',
  'changes_md',
  'doc',
  'package_description',
  'git_commit',
  'shared-warehouse_fact',
  'shared-warehouse_insight',
] as const;

export function ContextBrowser() {
  const [items, setItems] = useState<ContextItem[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const load = async () => {
        setLoading(true);
        const params = new URLSearchParams();
        if (q.trim()) params.set('q', q.trim());
        if (kind !== 'all') params.set('kind', kind);
        params.set('limit', '50');
        try {
          const res = await fetch(`/api/context/items?${params}`);
          if (res.ok) {
            const data = await res.json();
            setItems(data.items);
            setCount(data.count);
          }
        } finally {
          setLoading(false);
        }
      };
      load();
    }, 200);
    return () => clearTimeout(t);
  }, [q, kind]);

  return (
    <div className="bs-card p-4">
      <div className="flex gap-3 mb-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or content…"
          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm font-sans focus:outline-none focus:border-[var(--accent)]"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] px-2 text-sm focus:outline-none focus:border-[var(--accent)]"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      <div className="mb-3 flex items-center gap-2 text-xs text-[var(--muted)]">
        {loading ? 'loading…' : count !== null ? `${count} items` : ''}
      </div>

      <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
        {items.length === 0 && !loading && (
          <div className="text-xs text-[var(--muted)] italic py-6 text-center">No items match.</div>
        )}
        {items.map((item) => (
          <details key={item.id} className="bs-card p-3">
            <summary className="cursor-pointer flex items-center gap-2 text-sm">
              <span className="bs-pill font-mono text-[0.625rem]">{item.kind}</span>
              <span className="text-[var(--text)] truncate flex-1">{item.title || '(untitled)'}</span>
              <span className="text-xs text-[var(--muted)] font-mono">{item.source_name}</span>
              {!item.has_embedding && (
                <span className="bs-pill" style={{ color: 'var(--warn)' }}>no-embed</span>
              )}
            </summary>
            <div className="mt-3 whitespace-pre-wrap text-xs text-[var(--text-dim)] font-mono leading-relaxed">
              {item.content.length > 1200 ? item.content.slice(0, 1200) + '\n\n… [truncated]' : item.content}
            </div>
            {Object.keys(item.metadata).length > 0 && (
              <div className="mt-2 text-[0.625rem] text-[var(--muted)] font-mono">
                {JSON.stringify(item.metadata)}
              </div>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
