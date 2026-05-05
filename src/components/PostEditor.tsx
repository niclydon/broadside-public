'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ContentGroupDetail,
  Platform,
  Post,
  PostStatus,
  PostVersion,
  Topic,
} from '@/lib/types';
import { POST_STATUSES } from '@/lib/types';
import { PostReview } from './PostReview';
import { GroupReview } from './GroupReview';
import { isThreadBody, parseThreadBody } from '@/lib/threads';
import { RichEditor } from './RichEditor';
import { markdownToHtml } from '@/lib/markdown';

interface Props {
  group: ContentGroupDetail;
  platforms: Platform[];
  topics: Topic[];
}

const STATUS_ACCENT: Record<PostStatus, string> = {
  draft: '#6b6b7a',
  queued: '#5aadf0',
  scheduled: '#a78bfa',
  ready: '#fbbf24',
  posted: '#4ade80',
  archived: '#434851',
};

export function PostEditor({ group: initialGroup, platforms, topics }: Props) {
  const [group, setGroup] = useState(initialGroup);
  const [activePlatform, setActivePlatform] = useState(
    initialGroup.posts[0]?.platform_id ?? platforms[0]?.id,
  );
  const [topicId, setTopicId] = useState(initialGroup.topic_id ?? '');
  const [status, setStatus] = useState<PostStatus>(initialGroup.status);
  const [tagInput, setTagInput] = useState(
    initialGroup.tags.map((t) => t.slug).join(', '),
  );
  const [notes, setNotes] = useState(initialGroup.notes ?? '');
  const [isSavingGroup, startSaveGroup] = useTransition();
  const [isArchiving, startArchive] = useTransition();
  const router = useRouter();
  const [groupError, setGroupError] = useState<string | null>(null);

  // Per-post editable state — keyed by post.id
  const [postState, setPostState] = useState<Record<string, { title: string; body: string; body_html: string; hashtags: string }>>(() => {
    const init: Record<string, { title: string; body: string; body_html: string; hashtags: string }> = {};
    for (const p of group.posts) {
      const plat = platforms.find((pl) => pl.id === p.platform_id);
      const bodyHtml = p.body_html
        ?? (plat?.supports_rich_text && p.body ? markdownToHtml(p.body) : '');
      init[p.id] = {
        title: p.title ?? '',
        body: p.body,
        body_html: bodyHtml,
        hashtags: (p.hashtags ?? []).join(' '),
      };
    }
    return init;
  });
  const [postSaving, setPostSaving] = useState<Record<string, boolean>>({});
  const [postError, setPostError] = useState<Record<string, string | null>>({});

  const activePost = useMemo(
    () => group.posts.find((p) => p.platform_id === activePlatform) ?? group.posts[0],
    [group, activePlatform],
  );

  const activePlatformMeta = useMemo(
    () => platforms.find((p) => p.id === activePost?.platform_id) ?? null,
    [platforms, activePost],
  );

  const activeVersions: PostVersion[] = activePost ? group.versions[activePost.id] ?? [] : [];

  const refreshGroup = async () => {
    const res = await fetch(`/api/content-groups/${group.id}`);
    if (res.ok) {
      const { group: fresh } = await res.json();
      setGroup(fresh);
    }
  };

  const saveGroupMeta = () => {
    setGroupError(null);
    startSaveGroup(async () => {
      const tag_slugs = tagInput
        .split(/[,\s]+/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);
      const res = await fetch(`/api/content-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic_id: topicId || null,
          status,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          notes: notes || null,
          tag_slugs,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'unknown' }));
        setGroupError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const { group: fresh } = await res.json();
      setGroup(fresh);
      router.refresh();
    });
  };

  const savePost = async (post: Post) => {
    const state = postState[post.id];
    setPostSaving((s) => ({ ...s, [post.id]: true }));
    setPostError((s) => ({ ...s, [post.id]: null }));
    try {
      const hashtags = state.hashtags
        .split(/[,\s]+/)
        .map((h) => h.trim().replace(/^#/, ''))
        .filter(Boolean);
      const res = await fetch(`/api/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: state.title || null,
          body: state.body,
          body_html: state.body_html || null,
          hashtags,
          edited_by: 'human',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'unknown' }));
        setPostError((s) => ({ ...s, [post.id]: data.error ?? `HTTP ${res.status}` }));
        return;
      }
      await refreshGroup();
    } finally {
      setPostSaving((s) => ({ ...s, [post.id]: false }));
    }
  };

  const markPublished = async (post: Post) => {
    const urlInput = window.prompt('Public URL (optional):') ?? undefined;
    const res = await fetch(`/api/posts/${post.id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posted_url: urlInput || undefined }),
    });
    if (res.ok) {
      await refreshGroup();
      router.refresh();
    }
  };

  const [isPublishingLinkedIn, setIsPublishingLinkedIn] = useState(false);
  const [isPublishingBluesky, setIsPublishingBluesky] = useState(false);
  const [isPublishingTwitter, setIsPublishingTwitter] = useState(false);
  const [isPublishingThread, setIsPublishingThread] = useState(false);
  const [isSendingNewsletter, setIsSendingNewsletter] = useState(false);
  const [isPublishingDevto, setIsPublishingDevto] = useState(false);
  const [isRepurposing, setIsRepurposing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');

  useEffect(() => {
    if (!initialGroup.scheduled_at) {
      setScheduledAt('');
      return;
    }
    const d = new Date(initialGroup.scheduled_at);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    setScheduledAt(local.toISOString().slice(0, 16));
  }, [initialGroup.scheduled_at]);

  const publishToLinkedIn = async (post: Post) => {
    if (!window.confirm('Publish this post to LinkedIn? This will appear on your feed immediately.')) return;
    setPublishError(null);
    setIsPublishingLinkedIn(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/linkedin`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setPublishError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.posted_url) {
        window.open(data.posted_url, '_blank');
      }
      await refreshGroup();
      router.refresh();
    } finally {
      setIsPublishingLinkedIn(false);
    }
  };

  const publishToBluesky = async (post: Post) => {
    if (!window.confirm('Publish this post to Bluesky? This will appear on your feed immediately.')) return;
    setPublishError(null);
    setIsPublishingBluesky(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/bluesky`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setPublishError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.posted_url) {
        window.open(data.posted_url, '_blank');
      }
      await refreshGroup();
      router.refresh();
    } finally {
      setIsPublishingBluesky(false);
    }
  };

  const publishToTwitter = async (post: Post) => {
    if (!window.confirm('Post this to X/Twitter? This will appear on your feed immediately.')) return;
    setPublishError(null);
    setIsPublishingTwitter(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/twitter`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setPublishError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.posted_url) {
        window.open(data.posted_url, '_blank');
      }
      await refreshGroup();
      router.refresh();
    } finally {
      setIsPublishingTwitter(false);
    }
  };

  const publishToDevto = async (post: Post) => {
    if (!window.confirm('Publish this post to Dev.to?')) return;
    setPublishError(null);
    setIsPublishingDevto(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/devto`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setPublishError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.posted_url) window.open(data.posted_url, '_blank');
      await refreshGroup();
      router.refresh();
    } finally {
      setIsPublishingDevto(false);
    }
  };

  const sendNewsletter = async (post: Post) => {
    if (!window.confirm('Send this to all active newsletter subscribers? This cannot be undone.')) return;
    setPublishError(null);
    setIsSendingNewsletter(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/newsletter`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setPublishError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      window.alert(`Sent to ${data.sent} subscribers${data.failed ? `, ${data.failed} failed` : ''}${data.skipped ? ` (${data.skipped} already received)` : ''}`);
      await refreshGroup();
      router.refresh();
    } finally {
      setIsSendingNewsletter(false);
    }
  };

  const publishThread = async (post: Post) => {
    const parts = parseThreadBody(postState[post.id]?.body ?? post.body);
    const platformLabel = post.platform_id === 'twitter' ? 'X/Twitter' : 'Bluesky';
    if (!window.confirm(`Publish this as a ${parts.length}-part thread on ${platformLabel}? Each part will be posted as a reply to the previous.`)) return;
    setPublishError(null);
    setIsPublishingThread(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/publish-thread`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setPublishError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.root_url) {
        window.open(data.root_url, '_blank');
      }
      await refreshGroup();
      router.refresh();
    } finally {
      setIsPublishingThread(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const copyRichHtml = (html: string, markdown: string) => {
    const blob = new Blob([html], { type: 'text/html' });
    const item = new ClipboardItem({
      'text/html': blob,
      'text/plain': new Blob([markdown], { type: 'text/plain' }),
    });
    navigator.clipboard.write([item]).catch(() => {
      navigator.clipboard.writeText(markdown).catch(() => {});
    });
  };

  const archive = () => {
    if (!window.confirm('Archive this content group?')) return;
    startArchive(async () => {
      const res = await fetch(`/api/content-groups/${group.id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/');
        router.refresh();
      }
    });
  };

  if (!activePost) {
    return (
      <div className="bs-card p-8 text-[var(--muted)]">
        This content group has no posts. Delete it and start over.
      </div>
    );
  }

  const currentState = postState[activePost.id];
  const bodyLen = currentState.body.length;
  const titleLen = currentState.title.length;
  const bodyLimit = activePlatformMeta?.max_body_chars ?? null;
  const titleLimit = activePlatformMeta?.max_title_chars ?? null;
  const bodyOver = bodyLimit !== null && bodyLen > bodyLimit;
  const titleOver = titleLimit !== null && titleLen > titleLimit;
  const canSave = !bodyOver && !titleOver && !postSaving[activePost.id];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      {/* Main editor column */}
      <div>
        {/* Group-level campaign review */}
        {group.posts.length > 1 && (
          <GroupReview
            groupId={group.id}
            posts={group.posts.map((p) => ({
              platform: p.platform_id,
              title: postState[p.id]?.title || null,
              body: postState[p.id]?.body ?? p.body,
              hashtags: (postState[p.id]?.hashtags ?? '').split(/[,\s]+/).filter(Boolean),
            }))}
            onApplySuggestion={(platform, current, suggested) => {
              const post = group.posts.find((p) => p.platform_id === platform);
              if (!post) return;
              const state = postState[post.id];
              if (!state) return;
              if (state.body.includes(current)) {
                setPostState((s) => ({
                  ...s,
                  [post.id]: { ...s[post.id], body: s[post.id].body.replace(current, suggested) },
                }));
              } else if (state.title.includes(current)) {
                setPostState((s) => ({
                  ...s,
                  [post.id]: { ...s[post.id], title: s[post.id].title.replace(current, suggested) },
                }));
              } else {
                navigator.clipboard.writeText(suggested).catch(() => {});
              }
            }}
          />
        )}

        {/* Platform tabs */}
        <div className="flex gap-1 mb-4 border-b border-[var(--border)]">
          {group.posts.map((p) => {
            const meta = platforms.find((pl) => pl.id === p.platform_id);
            const active = p.platform_id === activePlatform;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePlatform(p.platform_id)}
                className="px-4 py-2 text-sm font-medium transition-colors relative"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-dim)',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: '-1px',
                }}
              >
                {meta?.name ?? p.platform_id}
                <span className="bs-pill ml-2">{p.status}</span>
              </button>
            );
          })}
        </div>

        <div className="bs-card p-5">
          {activePlatformMeta?.max_title_chars !== null && activePlatformMeta?.max_title_chars !== undefined && (
            <div className="mb-4">
              <label className="bs-label block mb-1" htmlFor={`title-${activePost.id}`}>
                Title
                <span
                  className="ml-3 font-mono tabular-nums"
                  style={{ color: titleOver ? 'var(--danger)' : 'var(--muted)' }}
                >
                  {titleLen}/{titleLimit}
                </span>
              </label>
              <input
                id={`title-${activePost.id}`}
                type="text"
                value={currentState.title}
                onChange={(e) =>
                  setPostState((s) => ({
                    ...s,
                    [activePost.id]: { ...s[activePost.id], title: e.target.value },
                  }))
                }
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm font-sans focus:outline-none focus:border-[var(--accent)]"
                placeholder="Post title"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="bs-label block mb-1" htmlFor={`body-${activePost.id}`}>
              Body
              <span
                className="ml-3 font-mono tabular-nums"
                style={{ color: bodyOver ? 'var(--danger)' : 'var(--muted)' }}
              >
                {bodyLen}{bodyLimit ? `/${bodyLimit}` : ''}
              </span>
            </label>
            {activePlatformMeta?.supports_rich_text ? (
              <RichEditor
                key={activePost.id}
                initialHtml={currentState.body_html}
                onChange={(html, md) =>
                  setPostState((s) => ({
                    ...s,
                    [activePost.id]: { ...s[activePost.id], body: md, body_html: html },
                  }))
                }
                placeholder={
                  activePlatform === 'substack' ? 'Write your essay…' :
                  activePlatform === 'newsletter' ? 'Write your newsletter…' :
                  activePlatform === 'devto' ? 'Write your article…' :
                  activePlatform === 'linkedin-article' ? 'Write your LinkedIn article…' :
                  'Start writing…'
                }
                supportsImages={true}
              />
            ) : (
              <textarea
                id={`body-${activePost.id}`}
                value={currentState.body}
                onChange={(e) =>
                  setPostState((s) => ({
                    ...s,
                    [activePost.id]: { ...s[activePost.id], body: e.target.value },
                  }))
                }
                className="w-full min-h-[360px] rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-3 text-sm font-sans leading-relaxed focus:outline-none focus:border-[var(--accent)]"
                placeholder={
                  activePlatform === 'linkedin'
                    ? 'Write your post…'
                    : activePlatform === 'bluesky'
                      ? "What's on your mind? (300 chars)"
                      : activePlatform === 'twitter'
                        ? "What's happening? (280 chars)"
                        : 'Start writing…'
                }
              />
            )}
          </div>

          <div className="mb-4">
            <label className="bs-label block mb-1" htmlFor={`hashtags-${activePost.id}`}>
              Hashtags
            </label>
            <input
              id={`hashtags-${activePost.id}`}
              type="text"
              value={currentState.hashtags}
              onChange={(e) =>
                setPostState((s) => ({
                  ...s,
                  [activePost.id]: { ...s[activePost.id], hashtags: e.target.value },
                }))
              }
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
              placeholder="ai security jailbreak"
            />
          </div>

          {postError[activePost.id] && (
            <div className="text-xs mb-3" style={{ color: 'var(--danger)' }}>
              {postError[activePost.id]}
            </div>
          )}
          {publishError && (
            <div className="text-xs mb-3" style={{ color: 'var(--danger)' }}>
              {activePost.platform_id}: {publishError}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-[var(--muted)]">
              {activeVersions.length > 0
                ? `v${activeVersions[0].version + 1} · saved v${activeVersions[0].version} ${new Date(activeVersions[0].created_at).toLocaleString()}`
                : 'v1 · not yet saved'}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="bs-btn"
                onClick={() => copyToClipboard(
                  activePlatformMeta?.max_title_chars
                    ? `${currentState.title}\n\n${currentState.body}`
                    : currentState.body,
                )}
              >
                Copy
              </button>
              {(activePlatform === 'substack' || activePlatform === 'linkedin-article') && (
                <button
                  type="button"
                  className="bs-btn"
                  onClick={() => copyRichHtml(
                    currentState.body_html || '',
                    currentState.title
                      ? `# ${currentState.title}\n\n${currentState.body}`
                      : currentState.body,
                  )}
                >
                  {activePlatform === 'linkedin-article' ? 'Copy for LinkedIn Article' : 'Copy for Substack'}
                </button>
              )}
              {activePost.status !== 'posted' && (
                <>
                  {activePost.platform_id === 'linkedin' && (
                    <button
                      type="button"
                      className="bs-btn"
                      style={{ background: '#0a66c2', borderColor: '#0a66c2', color: '#fff' }}
                      disabled={isPublishingLinkedIn || bodyOver}
                      onClick={() => publishToLinkedIn(activePost)}
                    >
                      {isPublishingLinkedIn ? 'Publishing…' : 'Post to LinkedIn'}
                    </button>
                  )}
                  {activePost.platform_id === 'bluesky' && (
                    isThreadBody(postState[activePost.id]?.body ?? activePost.body) ? (
                      <button
                        type="button"
                        className="bs-btn"
                        style={{ background: '#1185fe', borderColor: '#1185fe', color: '#fff' }}
                        disabled={isPublishingThread}
                        onClick={() => publishThread(activePost)}
                      >
                        {isPublishingThread
                          ? 'Publishing thread…'
                          : `Post thread (${parseThreadBody(postState[activePost.id]?.body ?? activePost.body).length} parts)`}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="bs-btn"
                        style={{ background: '#1185fe', borderColor: '#1185fe', color: '#fff' }}
                        disabled={isPublishingBluesky}
                        onClick={() => publishToBluesky(activePost)}
                      >
                        {isPublishingBluesky ? 'Publishing…' : 'Post to Bluesky'}
                      </button>
                    )
                  )}
                  {activePost.platform_id === 'twitter' && (
                    isThreadBody(postState[activePost.id]?.body ?? activePost.body) ? (
                      <button
                        type="button"
                        className="bs-btn"
                        style={{ background: '#000', borderColor: '#333', color: '#fff' }}
                        disabled={isPublishingThread}
                        onClick={() => publishThread(activePost)}
                      >
                        {isPublishingThread
                          ? 'Publishing thread…'
                          : `Post thread (${parseThreadBody(postState[activePost.id]?.body ?? activePost.body).length} parts)`}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="bs-btn"
                        style={{ background: '#000', borderColor: '#333', color: '#fff' }}
                        disabled={isPublishingTwitter}
                        onClick={() => publishToTwitter(activePost)}
                      >
                        {isPublishingTwitter ? 'Publishing…' : 'Post to X'}
                      </button>
                    )
                  )}
                  {activePost.platform_id === 'newsletter' && (
                    <button
                      type="button"
                      className="bs-btn"
                      style={{ background: '#6366f1', borderColor: '#6366f1', color: '#fff' }}
                      disabled={isSendingNewsletter}
                      onClick={() => sendNewsletter(activePost)}
                    >
                      {isSendingNewsletter ? 'Sending…' : 'Send newsletter'}
                    </button>
                  )}
                  {activePost.platform_id === 'devto' && (
                    <button
                      type="button"
                      className="bs-btn"
                      style={{ background: '#000', borderColor: '#fff', color: '#fff' }}
                      disabled={isPublishingDevto}
                      onClick={() => publishToDevto(activePost)}
                    >
                      {isPublishingDevto ? 'Publishing…' : 'Post to Dev.to'}
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                className="bs-btn"
                disabled={activePost.status === 'posted'}
                onClick={() => markPublished(activePost)}
              >
                Mark posted
              </button>
              <button
                type="button"
                className="bs-btn bs-btn-primary"
                disabled={!canSave}
                onClick={() => savePost(activePost)}
              >
                {postSaving[activePost.id] ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* Version history for active platform */}
        <div className="mt-6">
          <div className="bs-label mb-2">Version history · {activePlatformMeta?.name}</div>
          {activeVersions.length === 0 ? (
            <div className="text-xs text-[var(--muted)] italic">No saved versions yet.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {activeVersions.map((v) => (
                <details key={v.id} className="bs-card p-3">
                  <summary className="text-xs text-[var(--text-dim)] cursor-pointer flex items-center gap-2">
                    <span className="font-mono text-[var(--accent)]">v{v.version}</span>
                    <span>{new Date(v.created_at).toLocaleString()}</span>
                    <span className="bs-pill">{v.edited_by}</span>
                    <span className="text-[var(--muted)]">·</span>
                    <span className="text-[var(--muted)]">{v.body.length} chars</span>
                  </summary>
                  <div className="mt-3 text-sm text-[var(--text)] whitespace-pre-wrap font-sans">
                    {v.title && <div className="font-semibold mb-2">{v.title}</div>}
                    {v.body}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

        {/* LLM Review */}
        <PostReview
          postId={activePost.id}
          body={currentState.body}
          title={currentState.title || null}
          platform={activePost.platform_id}
          hashtags={currentState.hashtags.split(/[,\s]+/).filter(Boolean)}
          onUpdateBody={(newBody) =>
            setPostState((s) => ({
              ...s,
              [activePost.id]: { ...s[activePost.id], body: newBody },
            }))
          }
          onUpdateTitle={(newTitle) =>
            setPostState((s) => ({
              ...s,
              [activePost.id]: { ...s[activePost.id], title: newTitle },
            }))
          }
        />
      </div>

      {/* Sidebar: status/topic/tags/notes */}
      <aside className="flex flex-col gap-4">
        <div className="bs-card p-4">
          <div className="bs-label mb-2">Status</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as PostStatus)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            {POST_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: STATUS_ACCENT[status] }}
            />
            <span className="text-[var(--text-dim)]">{group.status}</span>
          </div>
        </div>

        <div className="bs-card p-4">
          <div className="bs-label mb-2">Topic</div>
          <select
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="">— none —</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="bs-card p-4">
          <label className="bs-label block mb-2" htmlFor="schedule">Schedule</label>
          <input
            id="schedule"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
          />
          <p className="text-[0.6875rem] text-[var(--muted)] mt-1">
            Set a time and save metadata → status to &quot;scheduled&quot; for auto-publish.
          </p>
        </div>

        <div className="bs-card p-4">
          <div className="bs-label mb-2">Repurpose</div>
          <p className="text-[0.6875rem] text-[var(--muted)] mb-2">Auto-derive shorter/longer variants for other platforms.</p>
          <button
            type="button"
            className="bs-btn w-full justify-center"
            disabled={isRepurposing}
            onClick={async () => {
              const current = activePost.platform_id;
              const others = ['linkedin', 'bluesky', 'twitter', 'substack'].filter((p) => p !== current);
              setIsRepurposing(true);
              setPublishError(null);
              try {
                const res = await fetch(`/api/posts/${activePost.id}/repurpose`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ target_platforms: others }),
                });
                const data = await res.json();
                if (!res.ok) {
                  setPublishError(data.error ?? 'repurpose failed');
                } else {
                  router.push('/');
                  router.refresh();
                }
              } finally {
                setIsRepurposing(false);
              }
            }}
          >
            {isRepurposing ? 'Repurposing…' : `Repurpose → all other platforms`}
          </button>
        </div>

        <div className="bs-card p-4">
          <label className="bs-label block mb-2" htmlFor="tags">Tags</label>
          <input
            id="tags"
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm font-mono focus:outline-none focus:border-[var(--accent)]"
            placeholder="cluster upgrade notes"
          />
          <p className="text-[0.6875rem] text-[var(--muted)] mt-1">Space or comma separated. New tags are auto-created.</p>
        </div>

        <div className="bs-card p-4">
          <label className="bs-label block mb-2" htmlFor="notes">Private notes</label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full min-h-[100px] rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] p-2 text-sm font-sans focus:outline-none focus:border-[var(--accent)]"
            placeholder="Never published. For your future self."
          />
        </div>

        {groupError && (
          <div className="text-xs" style={{ color: 'var(--danger)' }}>{groupError}</div>
        )}

        <button
          type="button"
          className="bs-btn bs-btn-primary"
          onClick={saveGroupMeta}
          disabled={isSavingGroup}
        >
          {isSavingGroup ? 'Saving…' : 'Save metadata'}
        </button>

        <button
          type="button"
          className="bs-btn"
          onClick={archive}
          disabled={isArchiving}
          style={{ color: 'var(--danger)' }}
        >
          {isArchiving ? 'Archiving…' : 'Archive'}
        </button>
      </aside>
    </div>
  );
}
