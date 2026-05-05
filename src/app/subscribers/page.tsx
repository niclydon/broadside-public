import type { Metadata } from 'next';
import { query } from '@/lib/db/pool';
import { SubscriberList } from '@/components/SubscriberList';

export const metadata: Metadata = { title: 'Subscribers — Broadside' };
export const dynamic = 'force-dynamic';

interface Row {
  active: string;
  unsubscribed: string;
  total: string;
}

export default async function SubscribersPage() {
  const { rows } = await query<Row>(
    `SELECT COUNT(*) FILTER (WHERE unsubscribed_at IS NULL) AS active,
            COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL) AS unsubscribed,
            COUNT(*) AS total
       FROM newsletter_subscribers`,
  );

  const stats = {
    active: Number(rows[0]?.active ?? 0),
    unsubscribed: Number(rows[0]?.unsubscribed ?? 0),
    total: Number(rows[0]?.total ?? 0),
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bs-label">Newsletter</div>
      <h1 className="text-2xl font-semibold text-[var(--text)] mt-1 mb-1">Subscribers</h1>
      <p className="text-sm text-[var(--text-dim)] mb-6">
        {stats.active} active &middot; {stats.unsubscribed} unsubscribed &middot; {stats.total} total
      </p>
      <SubscriberList initialStats={stats} />
    </div>
  );
}
