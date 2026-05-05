'use client';

import { useState, useEffect, useCallback } from 'react';

interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  subscribed_at: string;
  unsubscribed_at: string | null;
  source: string | null;
  notes: string | null;
}

interface Stats {
  active: number;
  unsubscribed: number;
  total: number;
}

export function SubscriberList({ initialStats }: { initialStats: Stats }) {
  const [stats, setStats] = useState(initialStats);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [filter, setFilter] = useState<'active' | 'unsubscribed' | 'all'>('active');
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/subscribers?status=${filter}`);
    const data = await res.json();
    setSubscribers(data.subscribers);
    setStats(data.stats);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function addSubscriber(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, name: newName || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setNewEmail('');
      setNewName('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggleUnsubscribe(s: Subscriber) {
    const unsubscribe = s.unsubscribed_at === null;
    await fetch(`/api/subscribers/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unsubscribe }),
    });
    load();
  }

  async function deleteSubscriber(s: Subscriber) {
    if (!confirm(`Permanently delete ${s.email}?`)) return;
    await fetch(`/api/subscribers/${s.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div>
      {/* Add form */}
      <form onSubmit={addSubscriber} className="bs-card p-4 mb-6">
        <div className="bs-label mb-2">Add subscriber</div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[0.6875rem] text-[var(--muted)] block mb-1">Email</label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="person@example.com"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="text-[0.6875rem] text-[var(--muted)] block mb-1">Name (optional)</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Person Name"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <button type="submit" disabled={busy} className="bs-btn bs-btn-primary">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
        {addError && <div className="text-xs mt-2" style={{ color: 'var(--danger)' }}>{addError}</div>}
      </form>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {(['active', 'unsubscribed', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              filter === f
                ? 'bg-[var(--accent)] text-[var(--bg)] font-medium'
                : 'bg-[var(--surface)] text-[var(--text-dim)] hover:text-[var(--text)] border border-[var(--border)]'
            }`}
          >
            {f === 'active' ? `Active (${stats.active})`
              : f === 'unsubscribed' ? `Unsubscribed (${stats.unsubscribed})`
                : `All (${stats.total})`}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-sm text-[var(--muted)] py-8 text-center">Loading…</div>
      ) : subscribers.length === 0 ? (
        <div className="bs-card p-8 text-center text-sm text-[var(--muted)]">
          No subscribers in this view.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {subscribers.map(s => (
            <div key={s.id} className={`bs-card p-3 ${s.unsubscribed_at ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text)] font-medium">{s.email}</div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
                    {s.name && <span>{s.name}</span>}
                    <span>
                      subscribed {new Date(s.subscribed_at).toLocaleDateString()}
                    </span>
                    {s.unsubscribed_at && (
                      <span>unsubscribed {new Date(s.unsubscribed_at).toLocaleDateString()}</span>
                    )}
                    {s.source && <span>{s.source}</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => toggleUnsubscribe(s)}
                    className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-dim)] hover:text-[var(--text)]"
                  >
                    {s.unsubscribed_at ? 'Resubscribe' : 'Unsubscribe'}
                  </button>
                  <button
                    onClick={() => deleteSubscriber(s)}
                    className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:border-red-500 text-[var(--text-dim)] hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
