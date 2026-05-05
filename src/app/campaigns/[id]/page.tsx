import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getContentGroupDetail } from '@/lib/content';
import { CampaignDetail } from '@/components/CampaignDetail';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Campaign — Broadside' };
export const dynamic = 'force-dynamic';

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const group = await getContentGroupDetail(id);
  if (!group) notFound();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <Link href="/campaigns" className="text-xs text-[var(--muted)] hover:text-[var(--accent)]">
          ← Campaigns
        </Link>
        <div className="bs-label mt-2 capitalize">{group.status}</div>
        <h1 className="text-2xl font-semibold text-[var(--text)] mt-1">
          {group.posts[0]?.body
            ? group.posts[0].body.split('\n')[0].slice(0, 80) + (group.posts[0].body.split('\n')[0].length > 80 ? '…' : '')
            : group.topic?.name ?? 'Untitled campaign'}
        </h1>
        {group.topic?.name && (
          <span
            className="bs-pill mt-2 inline-block"
            style={{ borderColor: (group.topic.color ?? 'var(--accent)') + '40', color: group.topic.color ?? 'var(--accent)' }}
          >
            {group.topic.name}
          </span>
        )}
      </div>

      <CampaignDetail group={group} />
    </div>
  );
}
