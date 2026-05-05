'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface LinkedInConnection {
  connected: boolean;
  display_name: string | null;
  member_urn: string | null;
  expires_at: string | null;
}

interface Props {
  connection: LinkedInConnection;
  analytics: { post_count: number; latest_fetch: string | null };
  justConnected: boolean;
  error?: string | null;
}

export function LinkedInSettings({ connection, analytics, justConnected, error }: Props) {
  const router = useRouter();
  const [importResult, setImportResult] = useState<string | null>(null);
  const [analyticsResult, setAnalyticsResult] = useState<string | null>(null);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [isImporting, startImport] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();
  const [isUploadingCsv, setIsUploadingCsv] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const handleImport = () => {
    startImport(async () => {
      const res = await fetch('/api/linkedin/import?count=50', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setImportResult(`Imported ${data.imported} posts, skipped ${data.skipped}`);
        router.refresh();
      } else {
        setImportResult(`Error: ${data.error}`);
      }
    });
  };

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingCsv(true);
    setCsvResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/linkedin/import-csv', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setCsvResult(
          `Imported ${data.imported} of ${data.total_rows} · skipped ${data.skipped_empty} empty, ${data.skipped_duplicate} duplicates${data.failed ? `, ${data.failed} failed` : ''}`,
        );
        router.refresh();
      } else {
        setCsvResult(`Error: ${data.error}`);
      }
    } catch (err) {
      setCsvResult(`Error: ${(err as Error).message}`);
    } finally {
      setIsUploadingCsv(false);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const handleRefreshAnalytics = () => {
    startRefresh(async () => {
      const res = await fetch('/api/linkedin/analytics', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setAnalyticsResult(`Refreshed ${data.refreshed} posts, ${data.failed} failed`);
        router.refresh();
      } else {
        setAnalyticsResult(`Error: ${data.error}`);
      }
    });
  };

  const expiresIn = connection.expires_at
    ? Math.max(0, Math.round((new Date(connection.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div className="bs-card p-5">
      <div className="bs-label mb-3">LinkedIn integration</div>

      {justConnected && (
        <div className="mb-4 p-3 rounded-md bg-[var(--success)]/10 border border-[var(--success)]/20 text-sm" style={{ color: 'var(--success)' }}>
          LinkedIn connected successfully!
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-md bg-[var(--danger)]/10 border border-[var(--danger)]/20 text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {!connection.connected ? (
        <div>
          <p className="text-sm text-[var(--text-dim)] mb-4">
            Connect your LinkedIn account to import your existing posts and enable performance monitoring.
          </p>
          <a href="/api/auth/linkedin" className="bs-btn bs-btn-primary mb-6">
            Connect LinkedIn
          </a>

          <div className="border-t border-[var(--border)] pt-4 mt-6">
            <div className="bs-label mb-2">Import historical posts (CSV)</div>
            <p className="text-xs text-[var(--text-dim)] mb-3">
              No connection needed — download your data from LinkedIn (Settings → Data privacy → Get a copy of your data → Posts),
              then upload the <code className="font-mono text-[var(--accent)]">Shares.csv</code> file here.
            </p>
            <label className="bs-btn inline-flex items-center gap-2 cursor-pointer">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvUpload}
                disabled={isUploadingCsv}
                className="hidden"
              />
              {isUploadingCsv ? 'Uploading…' : 'Upload Shares.csv'}
            </label>
            {csvResult && (
              <div className="text-xs text-[var(--text-dim)] mt-2">{csvResult}</div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2 h-2 rounded-full" style={{ background: 'var(--success)' }} />
            <span className="text-sm text-[var(--text)]">
              Connected as <strong>{connection.display_name}</strong>
            </span>
            <span className="bs-pill font-mono">{connection.member_urn}</span>
            {expiresIn !== null && (
              <span className="text-[0.6875rem] text-[var(--muted)]">
                token expires in {expiresIn}d
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-3 mb-4">
            <button
              type="button"
              className="bs-btn"
              onClick={handleImport}
              disabled={isImporting}
            >
              {isImporting ? 'Importing…' : 'Import recent posts'}
            </button>
            <button
              type="button"
              className="bs-btn"
              onClick={handleRefreshAnalytics}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing…' : 'Refresh analytics'}
            </button>
            <a href="/api/auth/linkedin" className="bs-btn">
              Reconnect
            </a>
          </div>

          {importResult && (
            <div className="text-xs text-[var(--text-dim)] mb-2">{importResult}</div>
          )}
          {analyticsResult && (
            <div className="text-xs text-[var(--text-dim)] mb-2">{analyticsResult}</div>
          )}

          <div className="text-xs text-[var(--muted)] mb-4">
            {analytics.post_count > 0
              ? `${analytics.post_count} posts with analytics · last refreshed ${analytics.latest_fetch ? new Date(analytics.latest_fetch).toLocaleString() : 'never'}`
              : 'No analytics data yet. Import posts first, then click Refresh analytics.'}
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <div className="bs-label mb-2">Import historical posts (CSV)</div>
            <p className="text-xs text-[var(--text-dim)] mb-3">
              LinkedIn&rsquo;s read API is gated behind Community Management. To backfill old posts,
              download your data from LinkedIn (Settings → Data privacy → Get a copy of your data → Posts),
              then upload the <code className="font-mono text-[var(--accent)]">Shares.csv</code> file here.
            </p>
            <label className="bs-btn inline-flex items-center gap-2 cursor-pointer">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvUpload}
                disabled={isUploadingCsv}
                className="hidden"
              />
              {isUploadingCsv ? 'Uploading…' : 'Upload Shares.csv'}
            </label>
            {csvResult && (
              <div className="text-xs text-[var(--text-dim)] mt-2">{csvResult}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
