'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ContentGroupDetail, Post } from '@/lib/types';
import { GroupReview } from './GroupReview';
import { CampaignMedia } from './CampaignMedia';

const PLATFORM_COLOR: Record<string, string> = {
  linkedin: '#0a66c2',
  substack: '#ff6719',
  bluesky: '#1185fe',
  twitter: '#1d9bf0',
};

const PLATFORM_ORDER = ['substack', 'linkedin', 'bluesky', 'twitter'];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: '#6b6b7a', queued: '#5aadf0', scheduled: '#a78bfa',
    ready: '#fbbf24', posted: '#4ade80', archived: '#434851',
  };
  return <span className="w-2 h-2 rounded-full inline-block" style={{ background: colors[status] ?? '#6b6b7a' }} />;
}

interface Props {
  group: ContentGroupDetail;
}

export function CampaignDetail({ group: initialGroup }: Props) {
  const [group, setGroup] = useState(initialGroup);
  const [urlInputs, setUrlInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of initialGroup.posts) {
      init[p.id] = p.posted_url ?? '';
    }
    return init;
  });
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenResult, setRegenResult] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProvider, setRefreshProvider] = useState('anthropic');
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishLog, setPublishLog] = useState<string[]>([]);
  const router = useRouter();

  const sortedPosts = [...group.posts].sort(
    (a, b) => PLATFORM_ORDER.indexOf(a.platform_id) - PLATFORM_ORDER.indexOf(b.platform_id),
  );

  const publishedAnchors = group.posts.filter((p) => p.posted_url && p.status === 'posted');
  const unpublishedShortForm = group.posts.filter(
    (p) => !p.posted_url && ['bluesky', 'twitter'].includes(p.platform_id),
  );

  // Source post = longest body (the canonical version to derive from)
  const sourcePost = [...group.posts].sort((a, b) => b.body.length - a.body.length)[0];
  const downstreamPosts = group.posts.filter((p) => p.id !== sourcePost?.id);

  const REFRESH_PROVIDERS = [
    { id: 'anthropic', label: 'Opus' },
    { id: 'openai', label: 'GPT-4o' },
    { id: 'gemini', label: 'Gemini' },
    { id: 'deepseek', label: 'DeepSeek' },
    { id: 'grok', label: 'Grok' },
  ];

  const refreshDownstream = async () => {
    if (!sourcePost || downstreamPosts.length === 0) return;
    setRefreshing(true);
    setRefreshError(null);
    setRefreshResult(null);
    try {
      const res = await fetch(`/api/content-groups/${group.id}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_post_id: sourcePost.id,
          target_platforms: downstreamPosts.map((p) => p.platform_id),
          provider: refreshProvider,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRefreshError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setRefreshResult(`Refreshed ${data.updated_post_ids.length} post(s) from ${capitalize(sourcePost.platform_id)} via ${data.model} ($${data.cost_usd.toFixed(4)})`);
      await refreshGroup();
      router.refresh();
    } catch (err) {
      setRefreshError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const refreshGroup = async () => {
    const res = await fetch(`/api/content-groups/${group.id}`);
    if (res.ok) {
      const { group: fresh } = await res.json();
      setGroup(fresh);
      // Re-init URL inputs
      const newUrls: Record<string, string> = {};
      for (const p of fresh.posts) newUrls[p.id] = p.posted_url ?? '';
      setUrlInputs(newUrls);
    }
  };

  const saveUrl = async (post: Post) => {
    const url = urlInputs[post.id]?.trim();
    if (!url) return;
    setSaving((s) => ({ ...s, [post.id]: true }));
    try {
      // Mark this post as posted with the URL
      const res = await fetch(`/api/posts/${post.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posted_url: url }),
      });
      if (!res.ok) return;

      // Auto-append link to short-form sibling posts that don't have their own URL yet
      const platformLabel = capitalize(post.platform_id);
      const shortFormSiblings = group.posts.filter(
        (p) => p.id !== post.id && !p.posted_url && ['bluesky', 'twitter'].includes(p.platform_id),
      );
      for (const sibling of shortFormSiblings) {
        const limit = sibling.platform_id === 'twitter' ? 280 : 300;
        const linkSuffix = `\n\nFull post: ${url}`;
        // Only append if it fits within the platform limit (URLs auto-shorten on Twitter)
        const effectiveUrlLen = sibling.platform_id === 'twitter' ? 23 : url.length;
        const suffixLen = '\n\nFull post: '.length + effectiveUrlLen;
        if (sibling.body.length + suffixLen <= limit && !sibling.body.includes(url)) {
          await fetch(`/api/posts/${sibling.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: sibling.body + linkSuffix, edited_by: 'ai' }),
          });
        }
      }

      // Also append to LinkedIn siblings if they don't have a URL
      const linkedinSiblings = group.posts.filter(
        (p) => p.id !== post.id && !p.posted_url && p.platform_id === 'linkedin',
      );
      for (const sibling of linkedinSiblings) {
        const linkSuffix = `\n\nRead the full breakdown: ${url}`;
        if (!sibling.body.includes(url)) {
          await fetch(`/api/posts/${sibling.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: sibling.body + linkSuffix, edited_by: 'ai' }),
          });
        }
      }

      await refreshGroup();
      router.refresh();
    } finally {
      setSaving((s) => ({ ...s, [post.id]: false }));
    }
  };

  const regenerateShortForm = async () => {
    const targets = unpublishedShortForm.map((p) => p.platform_id);
    if (targets.length === 0) return;
    setRegenerating(true);
    setRegenError(null);
    setRegenResult(null);
    try {
      const res = await fetch(`/api/content-groups/${group.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_platforms: targets }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegenError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setRegenResult(`Regenerated ${data.updated_post_ids.length} post(s) with links ($${data.cost_usd.toFixed(4)})`);
      await refreshGroup();
      router.refresh();
    } catch (err) {
      setRegenError((err as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  // Posts that can be auto-published (have API support, not yet posted)
  const publishablePosts = group.posts.filter(
    (p) => p.status !== 'posted' && ['linkedin', 'bluesky', 'twitter'].includes(p.platform_id),
  );
  const hasUnposted = group.posts.some((p) => p.status !== 'posted');

  const publishCampaign = async () => {
    setPublishing(true);
    setPublishLog([]);
    const log = (msg: string) => setPublishLog((prev) => [...prev, msg]);

    // Publish in order: LinkedIn → Bluesky → Twitter
    // (Substack has no API — must be marked posted manually with URL)
    const publishOrder = ['linkedin', 'bluesky', 'twitter'];
    for (const platform of publishOrder) {
      const post = group.posts.find((p) => p.platform_id === platform && p.status !== 'posted');
      if (!post) continue;

      log(`Publishing to ${capitalize(platform)}…`);
      try {
        const res = await fetch(`/api/posts/${post.id}/${platform}`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          log(`${capitalize(platform)}: published${data.posted_url ? ` → ${data.posted_url}` : ''}`);
          if (data.posted_url) {
            window.open(data.posted_url, '_blank');
          }
        } else {
          log(`${capitalize(platform)}: failed — ${data.error ?? res.status}`);
        }
      } catch (err) {
        log(`${capitalize(platform)}: error — ${(err as Error).message}`);
      }
    }

    log('Campaign publish complete.');
    await refreshGroup();
    router.refresh();
    setPublishing(false);
  };

  return (
    <div>
      {/* Campaign Review */}
      <GroupReview
        groupId={group.id}
        posts={group.posts.map((p) => ({
          platform: p.platform_id,
          title: p.title ?? null,
          body: p.body,
          hashtags: p.hashtags ?? [],
        }))}
      />

      {/* Refresh downstream from source */}
      {sourcePost && downstreamPosts.length > 0 && (
        <div className="bs-card p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="bs-label">Refresh from source</div>
            <span className="text-[0.625rem] text-[var(--muted)]">
              {capitalize(sourcePost.platform_id)} ({sourcePost.body.length} chars) → {downstreamPosts.map((p) => capitalize(p.platform_id)).join(', ')}
            </span>
          </div>
          <p className="text-xs text-[var(--text-dim)] mb-3">
            Re-derive {downstreamPosts.length} downstream post{downstreamPosts.length !== 1 ? 's' : ''} from the current {capitalize(sourcePost.platform_id)} content.
            Each target post will be rewritten as a platform-appropriate adaptation. Previous versions are preserved in history.
          </p>
          <div className="flex items-center gap-2">
            <select
              value={refreshProvider}
              onChange={(e) => setRefreshProvider(e.target.value)}
              disabled={refreshing}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--accent)]"
            >
              {REFRESH_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="bs-btn bs-btn-primary text-xs"
              onClick={refreshDownstream}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : `Refresh ${downstreamPosts.map((p) => capitalize(p.platform_id)).join(' + ')}`}
            </button>
          </div>
          {refreshError && <div className="text-xs mt-2" style={{ color: 'var(--danger)' }}>{refreshError}</div>}
          {refreshResult && <div className="text-xs mt-2 text-[#4ade80]">{refreshResult}</div>}
        </div>
      )}

      {/* Regenerate with links */}
      {publishedAnchors.length > 0 && unpublishedShortForm.length > 0 && (
        <div className="bs-card p-4 mb-6">
          <div className="bs-label mb-2">Regenerate with links</div>
          <p className="text-xs text-[var(--text-dim)] mb-3">
            {publishedAnchors.length} published post{publishedAnchors.length !== 1 ? 's' : ''} with URLs.
            Regenerate {unpublishedShortForm.map((p) => capitalize(p.platform_id)).join(' + ')} to include links to the published content.
          </p>
          <button
            type="button"
            className="bs-btn bs-btn-primary text-xs"
            onClick={regenerateShortForm}
            disabled={regenerating}
          >
            {regenerating ? 'Regenerating…' : `Regenerate ${unpublishedShortForm.map((p) => capitalize(p.platform_id)).join(' + ')} with links`}
          </button>
          {regenError && <div className="text-xs mt-2" style={{ color: 'var(--danger)' }}>{regenError}</div>}
          {regenResult && <div className="text-xs mt-2 text-[#4ade80]">{regenResult}</div>}
        </div>
      )}

      {/* Publish campaign */}
      {hasUnposted && publishablePosts.length > 0 && (
        <div className="bs-card p-4 mb-6">
          <div className="bs-label mb-2">Publish campaign</div>
          <p className="text-xs text-[var(--text-dim)] mb-3">
            Publish {publishablePosts.map((p) => capitalize(p.platform_id)).join(' → ')} in sequence.
            {group.posts.some((p) => p.platform_id === 'substack' && p.status !== 'posted') && (
              <> Substack must be published manually — paste the URL above and mark posted first.</>
            )}
          </p>
          <button
            type="button"
            className="bs-btn bs-btn-primary text-xs"
            onClick={publishCampaign}
            disabled={publishing}
          >
            {publishing ? 'Publishing…' : `Publish ${publishablePosts.map((p) => capitalize(p.platform_id)).join(' + ')}`}
          </button>
          {publishLog.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {publishLog.map((line, i) => (
                <div key={i} className="text-[0.625rem] font-mono text-[var(--text-dim)]">{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Platform variants */}
      <div className="flex flex-col gap-4 mb-6">
        {sortedPosts.map((post) => (
          <div key={post.id} className="bs-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: PLATFORM_COLOR[post.platform_id] ?? 'var(--muted)' }}
              />
              <span className="font-mono text-sm font-medium text-[var(--text)]">
                {capitalize(post.platform_id)}
              </span>
              <StatusDot status={post.status} />
              <span className="text-[0.625rem] text-[var(--muted)] capitalize">{post.status}</span>
              {sourcePost && post.id === sourcePost.id && (
                <span className="text-[0.5rem] text-[var(--accent)] uppercase tracking-wider font-semibold border border-[var(--accent)] rounded px-1 py-0.5" style={{ opacity: 0.7 }}>
                  Source
                </span>
              )}
              <span className="font-mono text-[0.625rem] text-[var(--muted)] tabular-nums ml-auto">
                {post.char_count} chars
              </span>
            </div>

            {/* Post body preview */}
            {post.title && (
              <div className="text-sm font-semibold text-[var(--text)] mb-1">{post.title}</div>
            )}
            <div className="text-xs text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap mb-3 max-h-[200px] overflow-y-auto">
              {post.body}
            </div>

            {/* Published URL */}
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={urlInputs[post.id] ?? ''}
                onChange={(e) => setUrlInputs((s) => ({ ...s, [post.id]: e.target.value }))}
                placeholder={post.posted_url ? post.posted_url : 'Published URL…'}
                className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] px-2 py-1 text-xs font-mono focus:outline-none focus:border-[var(--accent)]"
              />
              {post.status !== 'posted' && (
                <button
                  type="button"
                  className="bs-btn text-xs"
                  onClick={() => saveUrl(post)}
                  disabled={saving[post.id] || !urlInputs[post.id]?.trim()}
                >
                  {saving[post.id] ? 'Saving…' : 'Mark posted'}
                </button>
              )}
              {post.posted_url && (
                <a
                  href={post.posted_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--accent)] hover:underline flex-shrink-0"
                >
                  View ↗
                </a>
              )}
            </div>

            {/* Edit link */}
            <div className="mt-2">
              <Link
                href={`/posts/${group.id}`}
                className="text-[0.625rem] text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              >
                Open in editor →
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Media assets */}
      <div className="mb-6">
        <CampaignMedia groupId={group.id} />
      </div>

      {/* Children / lineage */}
      {group.children && group.children.length > 0 && (
        <div className="bs-card p-4">
          <div className="bs-label mb-2">Derived content ({group.children.length})</div>
          <div className="flex flex-col gap-2">
            {group.children.map((child) => (
              <Link
                key={child.id}
                href={`/posts/${child.id}`}
                className="flex items-center gap-2 text-xs hover:text-[var(--accent)] transition-colors"
              >
                <StatusDot status={child.status} />
                <span className="text-[var(--text)]">{child.platform_ids.map(capitalize).join(' · ')}</span>
                {child.repurpose_type && <span className="bs-pill">{child.repurpose_type}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
