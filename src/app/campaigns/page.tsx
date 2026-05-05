import type { Metadata } from 'next';
import Link from 'next/link';
import { listContentGroups } from '@/lib/content';
import type { ContentGroupWithPosts } from '@/lib/types';
import { NewCampaignButton } from '@/components/NewCampaignButton';

export const metadata: Metadata = { title: 'Campaigns — Broadside' };
export const dynamic = 'force-dynamic';

function truncate(text: string, n: number): string {
  if (!text) return '';
  return text.length <= n ? text : text.slice(0, n).trimEnd() + '…';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STATUS_COLOR: Record<string, string> = {
  draft: '#6b6b7a',
  queued: '#5aadf0',
  scheduled: '#a78bfa',
  ready: '#fbbf24',
  posted: '#4ade80',
  archived: '#434851',
};

const PLATFORM_COLOR: Record<string, string> = {
  linkedin: '#0a66c2',
  substack: '#ff6719',
  bluesky: '#1185fe',
  twitter: '#000',
};

function CampaignCard({ group }: { group: ContentGroupWithPosts }) {
  const platforms = group.posts.map((p) => p.platform_id).sort();
  // Use the longest post as the "primary" for the preview
  const primary = [...group.posts].sort((a, b) => b.body.length - a.body.length)[0];
  const title = primary?.title ?? truncate(primary?.body?.split('\n')[0] ?? '', 80);

  return (
    <Link href={`/campaigns/${group.id}`} className="bs-card bs-card-hover block p-4">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: STATUS_COLOR[group.status] ?? '#6b6b7a' }}
        />
        <span className="text-[0.625rem] text-[var(--muted)] uppercase tracking-wider font-semibold">
          {group.status}
        </span>
        {group.topic && (
          <span
            className="text-[0.625rem] font-semibold uppercase tracking-wider"
            style={{ color: group.topic.color ?? 'var(--accent)' }}
          >
            {group.topic.name}
          </span>
        )}
        <span className="text-[0.625rem] text-[var(--muted)] ml-auto">{relativeTime(group.updated_at)}</span>
      </div>

      <h3 className="text-sm font-medium text-[var(--text)] mb-3 leading-snug">{title}</h3>

      {/* Platform variant grid */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(platforms.length, 4)}, 1fr)` }}>
        {group.posts
          .sort((a, b) => a.platform_id.localeCompare(b.platform_id))
          .map((p) => (
          <div key={p.id} className="rounded border border-[var(--border)] p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: PLATFORM_COLOR[p.platform_id] ?? 'var(--muted)' }}
              />
              <span className="text-[0.5625rem] font-mono text-[var(--text-dim)]">{capitalize(p.platform_id)}</span>
              <span className="text-[0.5rem] text-[var(--muted)] font-mono tabular-nums ml-auto">{p.char_count}</span>
            </div>
            <p className="text-[0.625rem] text-[var(--muted)] leading-snug line-clamp-3">
              {truncate(p.body, 120)}
            </p>
          </div>
        ))}
      </div>

      {group.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {group.tags.slice(0, 3).map((t) => (
            <span key={t.id} className="bs-pill text-[0.5625rem]">#{t.slug}</span>
          ))}
        </div>
      )}
    </Link>
  );
}

export default async function CampaignsPage() {
  const allGroups = await listContentGroups({ limit: 500 });
  const campaigns = allGroups.filter((g) => g.posts.length > 1);

  const byStatus = {
    active: campaigns.filter((g) => !['posted', 'archived'].includes(g.status)),
    posted: campaigns.filter((g) => g.status === 'posted'),
    archived: campaigns.filter((g) => g.status === 'archived'),
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="bs-label">Campaigns</div>
          <h1 className="text-2xl font-semibold text-[var(--text)] mt-1">Multi-platform campaigns</h1>
          <p className="text-sm text-[var(--text-dim)] mt-1">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} · content groups with 2+ platform variants
          </p>
        </div>
        <div className="flex gap-2 relative">
          <Link href="/" className="bs-btn">Queue view</Link>
          <NewCampaignButton />
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="bs-card p-8 flex flex-col items-center text-center">
          <div className="text-sm font-medium text-[var(--text)]">No campaigns yet</div>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-sm">
            Campaigns are content groups with posts for multiple platforms. Create a post and repurpose it, or use the Suggestions inbox to generate across platforms.
          </p>
          <Link href="/suggestions" className="bs-btn bs-btn-primary mt-4 text-xs">Generate drafts</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Active campaigns */}
          {byStatus.active.length > 0 && (
            <div>
              <div className="bs-label mb-3">In progress ({byStatus.active.length})</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {byStatus.active.map((g) => <CampaignCard key={g.id} group={g} />)}
              </div>
            </div>
          )}

          {/* Posted campaigns */}
          {byStatus.posted.length > 0 && (
            <div>
              <div className="bs-label mb-3">Published ({byStatus.posted.length})</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {byStatus.posted.map((g) => <CampaignCard key={g.id} group={g} />)}
              </div>
            </div>
          )}

          {/* Archived */}
          {byStatus.archived.length > 0 && (
            <details>
              <summary className="bs-label cursor-pointer hover:text-[var(--accent)] transition-colors mb-3">
                Archived ({byStatus.archived.length})
              </summary>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {byStatus.archived.map((g) => <CampaignCard key={g.id} group={g} />)}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
