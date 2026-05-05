import type { Metadata } from 'next';
import Link from 'next/link';
import { query } from '@/lib/db/pool';
import { ContextBrowser } from '@/components/ContextBrowser';
import { SyncNowButton } from '@/components/SyncNowButton';

export const metadata: Metadata = { title: 'Context — Broadside' };
export const dynamic = 'force-dynamic';

interface SourceRow {
  id: string;
  kind: string;
  name: string;
  path: string | null;
  last_synced_at: string | null;
  item_count: string;
}

async function loadSources(): Promise<SourceRow[]> {
  try {
    const { rows } = await query<SourceRow>(
      `SELECT cs.id, cs.kind, cs.name, cs.path, cs.last_synced_at,
              (SELECT COUNT(*)::text FROM context_items ci WHERE ci.source_id = cs.id) AS item_count
         FROM context_sources cs
        ORDER BY cs.kind, cs.name`,
    );
    return rows;
  } catch {
    return [];
  }
}

async function totals() {
  try {
    const { rows } = await query<{ items: string; embedded: string; kinds: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM context_items) AS items,
         (SELECT COUNT(*)::text FROM context_embeddings) AS embedded,
         (SELECT COUNT(DISTINCT kind)::text FROM context_items) AS kinds`,
    );
    return rows[0];
  } catch {
    return { items: '0', embedded: '0', kinds: '0' };
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function syncHealth(iso: string | null): { color: string; label: string } {
  if (!iso) return { color: '#ef4444', label: 'never' };
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hours < 24) return { color: '#4ade80', label: relativeTime(iso) };
  if (hours < 72) return { color: '#fbbf24', label: relativeTime(iso) };
  return { color: '#ef4444', label: relativeTime(iso) };
}

export default async function ContextPage() {
  const [sources, t] = await Promise.all([loadSources(), totals()]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="bs-label">Context</div>
          <h1 className="text-2xl font-semibold text-[var(--text)] mt-1">Ingested sources</h1>
          <p className="text-sm text-[var(--text-dim)] mt-1">
            {t.items} items · {t.embedded} embedded · {t.kinds} kinds
          </p>
        </div>
        <SyncNowButton />
      </div>

      <div className="bs-card p-4 mb-6">
        <div className="bs-label mb-2">Sources</div>
        {sources.length === 0 ? (
          <p className="text-xs text-[var(--muted)] italic">
            No sources yet. Click <strong className="text-[var(--accent)]">Sync Now</strong> to ingest from local
            project folders and the optional context database.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {sources.map((s) => {
              const health = syncHealth(s.last_synced_at);
              return (
                <div key={s.id} className="flex items-center justify-between text-sm gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: health.color }} title={health.label} />
                    <span className="bs-pill font-mono text-[0.625rem]">{s.kind}</span>
                    <span className="text-[var(--text)] truncate">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[0.625rem] text-[var(--muted)]">{health.label}</span>
                    <span className="font-mono tabular-nums text-[var(--text-dim)]">{s.item_count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <details className="bs-card p-4">
        <summary className="bs-label cursor-pointer hover:text-[var(--accent)] transition-colors">
          Browse ingested context
        </summary>
        <div className="mt-4">
          <ContextBrowser />
        </div>
      </details>

      <div className="mt-6 text-xs text-[var(--muted)]">
        <Link href="/jobs" className="hover:text-[var(--accent)]">Jobs →</Link>
      </div>
    </div>
  );
}
