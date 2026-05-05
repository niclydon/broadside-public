import type { Metadata } from 'next';
import Link from 'next/link';
import { listContentGroups, listPlatforms } from '@/lib/content';
import {
  POST_STATUSES,
  type ContentGroupWithPosts,
  type Platform,
  type PostStatus,
} from '@/lib/types';
import { NewPostButton } from '@/components/NewPostButton';

export const metadata: Metadata = { title: 'Queue — Broadside' };
export const dynamic = 'force-dynamic';

function truncate(text: string, n: number): string {
  if (!text) return '';
  return text.length <= n ? text : text.slice(0, n).trimEnd() + '…';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const COLUMNS: { key: PostStatus; label: string; accent: string }[] = [
  { key: 'draft',     label: 'Draft',     accent: '#6b6b7a' },
  { key: 'queued',    label: 'Queued',    accent: '#5aadf0' },
  { key: 'scheduled', label: 'Scheduled', accent: '#a78bfa' },
  { key: 'ready',     label: 'Ready',     accent: '#fbbf24' },
  { key: 'posted',    label: 'Posted',    accent: '#4ade80' },
  { key: 'archived',  label: 'Archived',  accent: '#434851' },
];

function QueueCard({ group }: { group: ContentGroupWithPosts }) {
  const primary = group.posts[0];
  const preview = primary ? truncate(primary.body, 160) : 'No content yet';
  const variantLabels = group.posts.map((p) => p.platform_id.charAt(0).toUpperCase() + p.platform_id.slice(1)).join(' · ');
  const isAi = group.source === 'ai_draft';

  return (
    <Link
      href={`/posts/${group.id}`}
      className="bs-card bs-card-hover block p-3 text-left"
    >
      <div className="flex items-center gap-2 mb-2 text-[0.6875rem]">
        {group.topic && (
          <span
            className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider"
            style={{ color: group.topic.color ?? 'var(--accent)' }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: group.topic.color ?? 'var(--accent)' }}
            />
            {group.topic.name}
          </span>
        )}
        {isAi && <span className="bs-pill" style={{ color: 'var(--accent)' }}>AI</span>}
      </div>
      <p className="text-sm text-[var(--text)] leading-snug whitespace-pre-wrap">{preview}</p>
      <div className="mt-3 flex items-center justify-between text-[0.6875rem] text-[var(--muted)]">
        <span className="font-mono">{variantLabels}</span>
        <span>{relativeTime(group.updated_at)}</span>
      </div>
      {group.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {group.tags.slice(0, 4).map((t) => (
            <span key={t.id} className="bs-pill">#{t.slug}</span>
          ))}
          {group.tags.length > 4 && (
            <span className="bs-pill">+{group.tags.length - 4}</span>
          )}
        </div>
      )}
    </Link>
  );
}

export default async function QueuePage() {
  let groups: ContentGroupWithPosts[] = [];
  let platforms: Platform[] = [];
  let error: string | null = null;

  try {
    [groups, platforms] = await Promise.all([listContentGroups(), listPlatforms()]);
  } catch (err) {
    error = (err as Error).message;
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bs-card p-8 text-center">
          <div className="bs-label mb-2" style={{ color: 'var(--danger)' }}>Database error</div>
          <p className="text-[var(--text)]">Cannot reach the broadside database.</p>
          <p className="text-xs text-[var(--muted)] font-mono mt-2">{error}</p>
        </div>
      </div>
    );
  }

  const byStatus: Record<PostStatus, ContentGroupWithPosts[]> = {
    draft: [], queued: [], scheduled: [], ready: [], posted: [], archived: [],
  };
  for (const g of groups) byStatus[g.status].push(g);

  const total = groups.length;

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <div className="bs-label">Queue</div>
          <h1 className="text-2xl font-semibold text-[var(--text)] mt-1">Content pipeline</h1>
          <p className="text-[var(--text-dim)] text-sm mt-1">
            {total} {total === 1 ? 'content group' : 'content groups'} across {POST_STATUSES.length} statuses
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/suggestions" className="bs-btn">Suggestions</Link>
          <NewPostButton platforms={platforms} />
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(200px, 1fr))` }}>
        {COLUMNS.map((col) => (
          <div key={col.key} className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1 pb-2 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: col.accent }} />
                <span className="bs-label">{col.label}</span>
              </div>
              <span className="text-sm font-mono tabular-nums text-[var(--text-dim)]">
                {byStatus[col.key].length}
              </span>
            </div>
            <div className="flex flex-col gap-2 min-h-[120px]">
              {byStatus[col.key].length === 0 ? (
                <div className="bs-card p-4 text-xs text-[var(--muted)] italic text-center border-dashed">
                  empty
                </div>
              ) : (
                byStatus[col.key].map((g) => <QueueCard key={g.id} group={g} />)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
