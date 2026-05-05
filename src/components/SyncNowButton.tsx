'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function SyncNowButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSync = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/context/sync', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'unknown' }));
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const { job_id } = await res.json();
      router.push(`/jobs?focus=${job_id}`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="bs-btn bs-btn-primary" onClick={handleSync} disabled={isPending}>
        {isPending ? 'Kicking off…' : 'Sync Now'}
      </button>
      {error && <div className="text-xs" style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}
