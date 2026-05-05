'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface ThreadPart {
  id: number;
  body: string;
}

const PLATFORM_LIMITS: Record<string, number> = { twitter: 280, bluesky: 300 };

export function ThreadComposer() {
  const [platform, setPlatform] = useState<'twitter' | 'bluesky'>('twitter');
  const [parts, setParts] = useState<ThreadPart[]>([{ id: 1, body: '' }]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const limit = PLATFORM_LIMITS[platform];
  const nextId = Math.max(...parts.map((p) => p.id)) + 1;

  const addPart = () => setParts((cur) => [...cur, { id: nextId, body: '' }]);
  const removePart = (id: number) => setParts((cur) => cur.filter((p) => p.id !== id));
  const updatePart = (id: number, body: string) =>
    setParts((cur) => cur.map((p) => (p.id === id ? { ...p, body } : p)));

  const totalChars = parts.reduce((sum, p) => sum + p.body.length, 0);
  const partCount = parts.length;

  const saveThread = () => {
    setError(null);
    startTransition(async () => {
      // Create a content_group, then one post per thread part with thread_index
      const cgRes = await fetch('/api/content-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform_ids: [platform],
          initial_body: parts[0].body,
          source: 'manual',
        }),
      });
      if (!cgRes.ok) {
        setError('Failed to create content group');
        return;
      }
      const { id: cgId } = await cgRes.json();

      // The first post was already created by the content group route.
      // For subsequent parts, we'll create additional posts with thread_index.
      // For now, concatenate all parts into the first post with --- separators
      // and mark it as a thread via notes. Full thread publishing comes later.
      const threadBody = parts.map((p, i) => `[${i + 1}/${partCount}]\n${p.body}`).join('\n\n---\n\n');

      // Update the first post with the full thread body
      const postsRes = await fetch(`/api/content-groups/${cgId}`);
      if (postsRes.ok) {
        const { group } = await postsRes.json();
        const firstPost = group.posts?.[0];
        if (firstPost) {
          await fetch(`/api/posts/${firstPost.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: threadBody }),
          });
        }
      }

      // Update notes to indicate this is a thread
      await fetch(`/api/content-groups/${cgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: `Thread: ${partCount} parts for ${platform}` }),
      });

      router.push(`/posts/${cgId}`);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div>
          <label className="text-[0.6875rem] text-[var(--muted)] block mb-1">Platform</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'twitter' | 'bluesky')}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="twitter">X / Twitter (280/part)</option>
            <option value="bluesky">Bluesky (300/part)</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-[var(--muted)] font-mono tabular-nums">
          {partCount} parts · {totalChars} total chars
        </div>
      </div>

      <div className="flex flex-col gap-3 mb-6">
        {parts.map((part, idx) => {
          const charLen = [...part.body].length;
          const over = charLen > limit;
          return (
            <div key={part.id} className="bs-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="bs-label">{idx + 1}/{partCount}</span>
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono tabular-nums text-xs"
                    style={{ color: over ? 'var(--danger)' : 'var(--muted)' }}
                  >
                    {charLen}/{limit}
                  </span>
                  {parts.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-[var(--muted)] hover:text-[var(--danger)]"
                      onClick={() => removePart(part.id)}
                    >
                      remove
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={part.body}
                onChange={(e) => updatePart(part.id, e.target.value)}
                placeholder={idx === 0 ? 'Hook — the scroll-stopper' : `Part ${idx + 1}`}
                className="w-full min-h-[100px] rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-3 text-sm font-sans focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button type="button" className="bs-btn" onClick={addPart}>+ Add part</button>
        <div className="flex gap-2">
          {error && <span className="text-xs" style={{ color: 'var(--danger)' }}>{error}</span>}
          <button
            type="button"
            className="bs-btn bs-btn-primary"
            onClick={saveThread}
            disabled={isPending || parts.every((p) => !p.body.trim())}
          >
            {isPending ? 'Saving…' : 'Save thread'}
          </button>
        </div>
      </div>
    </div>
  );
}
