import type { Metadata } from 'next';
import { query } from '@/lib/db/pool';
import Link from 'next/link';
import { LinkedInSettings } from '@/components/LinkedInSettings';
import { SocialConnections } from '@/components/SocialConnections';

export const metadata: Metadata = { title: 'Settings — Broadside' };
export const dynamic = 'force-dynamic';

interface Setting {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

interface LinkedInConnection {
  connected: boolean;
  display_name: string | null;
  member_urn: string | null;
  expires_at: string | null;
}

async function loadSettings(): Promise<Setting[]> {
  try {
    const { rows } = await query<Setting>(
      `SELECT key, value, description, updated_at FROM settings ORDER BY key`,
    );
    return rows;
  } catch {
    return [];
  }
}

async function loadLinkedInStatus(): Promise<LinkedInConnection> {
  try {
    const { rows } = await query<{
      display_name: string | null;
      member_urn: string | null;
      expires_at: string | null;
    }>(`SELECT display_name, member_urn, expires_at FROM linkedin_tokens LIMIT 1`);
    if (rows.length === 0) return { connected: false, display_name: null, member_urn: null, expires_at: null };
    return { connected: true, ...rows[0] };
  } catch {
    return { connected: false, display_name: null, member_urn: null, expires_at: null };
  }
}

async function loadAnalyticsSummary(): Promise<{ post_count: number; latest_fetch: string | null }> {
  try {
    const { rows } = await query<{ post_count: string; latest_fetch: string | null }>(
      `SELECT COUNT(DISTINCT post_id)::text AS post_count, MAX(fetched_at)::text AS latest_fetch FROM post_analytics`,
    );
    return { post_count: parseInt(rows[0]?.post_count ?? '0', 10), latest_fetch: rows[0]?.latest_fetch };
  } catch {
    return { post_count: 0, latest_fetch: null };
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    linkedin_connected?: string;
    linkedin_error?: string;
    twitter_connected?: string;
    twitter_error?: string;
  }>;
}) {
  const [settings, linkedin, analytics, sp] = await Promise.all([
    loadSettings(),
    loadLinkedInStatus(),
    loadAnalyticsSummary(),
    searchParams,
  ]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bs-label">Settings</div>
      <h1 className="text-2xl font-semibold text-[var(--text)] mt-1 mb-1">Settings</h1>
      <p className="text-sm text-[var(--text-dim)] mb-8">
        Manage your integrations and preferences.
      </p>

      {/* LinkedIn connection */}
      <LinkedInSettings
        connection={linkedin}
        analytics={analytics}
        justConnected={sp.linkedin_connected === 'true'}
        error={sp.linkedin_error}
      />

      {sp.twitter_error && (
        <p className="text-xs text-red-400 mt-4">X connect error: {sp.twitter_error}</p>
      )}

      <SocialConnections justConnected={sp.twitter_connected} />

      {/* Related pages */}
      <div className="bs-card p-4 mt-6">
        <div className="bs-label mb-2">Related</div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/voice" className="bs-btn">Voice samples</Link>
          <Link href="/subscribers" className="bs-btn">Subscribers</Link>
          <Link href="/topics" className="bs-btn">Topics</Link>
          <Link href="/tags" className="bs-btn">Tags</Link>
          <Link href="/jobs" className="bs-btn">Jobs</Link>
        </div>
      </div>

      {/* Advanced settings (collapsed by default) */}
      <details className="mt-8">
        <summary className="bs-label cursor-pointer hover:text-[var(--accent)] transition-colors">
          Show advanced settings ({settings.length})
        </summary>
        <div className="flex flex-col gap-3 mt-3">
          {settings.map((s) => (
            <div key={s.key} className="bs-card p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-sm text-[var(--accent)]">{s.key}</span>
                <span className="text-[0.6875rem] text-[var(--muted)]">
                  updated {new Date(s.updated_at).toLocaleString()}
                </span>
              </div>
              {s.description && (
                <p className="text-xs text-[var(--text-dim)] mb-2">{s.description}</p>
              )}
              <pre className="text-xs font-mono bg-[var(--bg)] rounded p-2 overflow-x-auto text-[var(--text)]">
                {JSON.stringify(s.value, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
