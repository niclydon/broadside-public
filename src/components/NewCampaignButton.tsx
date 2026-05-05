'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PLATFORMS = [
  { id: 'substack', label: 'Substack', default: true },
  { id: 'linkedin', label: 'LinkedIn', default: true },
  { id: 'bluesky', label: 'Bluesky', default: true },
  { id: 'twitter', label: 'X / Twitter', default: true },
];

export function NewCampaignButton() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(PLATFORMS.filter((p) => p.default).map((p) => p.id)));
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    if (selected.size < 2) return;
    setCreating(true);
    try {
      const res = await fetch('/api/content-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform_ids: [...selected],
          notes: notes.trim() || undefined,
          source: 'manual',
        }),
      });
      if (res.ok) {
        const { id } = await res.json();
        router.push(`/campaigns/${id}`);
        router.refresh();
      }
    } finally {
      setCreating(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="bs-btn bs-btn-primary text-xs" onClick={() => setOpen(true)}>
        New campaign
      </button>
    );
  }

  return (
    <div className="bs-card p-4 absolute right-0 top-full mt-2 w-80 z-10 shadow-lg">
      <div className="bs-label mb-2">New campaign</div>
      <p className="text-[0.625rem] text-[var(--muted)] mb-3">Select platforms (min 2):</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="text-xs px-2 py-1 rounded border transition-colors"
            style={{
              borderColor: selected.has(p.id) ? 'var(--accent)' : 'var(--border)',
              color: selected.has(p.id) ? 'var(--accent)' : 'var(--muted)',
              background: selected.has(p.id) ? 'var(--accent)10' : 'transparent',
            }}
            onClick={() => toggle(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Campaign idea or angle (optional)…"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-xs font-sans min-h-[60px] mb-3 focus:outline-none focus:border-[var(--accent)]"
      />

      <div className="flex gap-2 justify-end">
        <button type="button" className="bs-btn text-xs" onClick={() => setOpen(false)}>Cancel</button>
        <button
          type="button"
          className="bs-btn bs-btn-primary text-xs"
          onClick={create}
          disabled={creating || selected.size < 2}
        >
          {creating ? 'Creating…' : `Create (${selected.size} platforms)`}
        </button>
      </div>
    </div>
  );
}
