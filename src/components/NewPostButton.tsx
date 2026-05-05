'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Platform } from '@/lib/types';

export function NewPostButton({ platforms }: { platforms: Platform[] }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(
    platforms.map((p) => p.id),
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((cur) =>
      cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id],
    );
  };

  const handleCreate = () => {
    if (selectedPlatforms.length === 0) {
      setError('Pick at least one platform');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/content-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform_ids: selectedPlatforms,
          initial_body: body || undefined,
          source: 'manual',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'unknown' }));
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const { id } = await res.json();
      setOpen(false);
      setBody('');
      router.push(`/posts/${id}`);
      router.refresh();
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="bs-btn bs-btn-primary">
        New post
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => !isPending && setOpen(false)}
        >
          <div
            className="bs-card p-6 w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bs-label mb-2">New content</div>
            <h2 className="text-xl font-semibold text-[var(--text)] mb-4">Start a draft</h2>

            <label className="bs-label block mb-2">Platforms</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {platforms.map((p) => {
                const selected = selectedPlatforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="bs-btn"
                    onClick={() => togglePlatform(p.id)}
                    style={{
                      background: selected ? 'var(--accent)' : undefined,
                      borderColor: selected ? 'var(--accent)' : undefined,
                      color: selected ? 'var(--bg)' : undefined,
                    }}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>

            <label className="bs-label block mb-2" htmlFor="body">Initial body (optional)</label>
            <textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full min-h-[140px] rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-3 text-sm font-sans focus:outline-none focus:border-[var(--accent)]"
              placeholder="Seed the draft with a rough hook or full body — you can edit per platform after."
            />

            {error && (
              <div className="mt-3 text-xs text-[var(--danger)]">{error}</div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="bs-btn"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bs-btn bs-btn-primary"
                onClick={handleCreate}
                disabled={isPending}
              >
                {isPending ? 'Creating…' : 'Create & open editor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
