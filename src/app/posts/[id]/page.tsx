import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContentGroupDetail, listPlatforms, listTopics } from '@/lib/content';
import { PostEditor } from '@/components/PostEditor';

export const dynamic = 'force-dynamic';

export default async function PostEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [group, platforms, topics] = await Promise.all([
    getContentGroupDetail(id),
    listPlatforms(),
    listTopics(),
  ]);

  if (!group) notFound();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-[var(--muted)] hover:text-[var(--accent)]">
            ← Queue
          </Link>
          <div className="bs-label mt-2 capitalize">{group.status}</div>
          <h1 className="text-2xl font-semibold text-[var(--text)] mt-1">
            {group.posts[0]?.body
              ? group.posts[0].body.split('\n')[0].slice(0, 80) + (group.posts[0].body.split('\n')[0].length > 80 ? '…' : '')
              : group.topic?.name ?? 'Untitled'}
          </h1>
          {group.topic?.name && group.posts[0]?.body && (
            <span
              className="bs-pill mt-2 inline-block"
              style={{ borderColor: (group.topic.color ?? 'var(--accent)') + '40', color: group.topic.color ?? 'var(--accent)' }}
            >
              {group.topic.name}
            </span>
          )}
        </div>
      </div>

      <PostEditor group={group} platforms={platforms} topics={topics} />
    </div>
  );
}
