import type { Metadata } from 'next';
import { query } from '@/lib/db/pool';
import { VoiceCuration } from '@/components/VoiceCuration';

export const metadata: Metadata = { title: 'Writing Samples — Broadside' };
export const dynamic = 'force-dynamic';

interface StatsRow {
  total: string;
  active: string;
  excluded_count: string;
  avg_len: string;
  platforms: string;
}

export default async function VoicePage() {
  const { rows } = await query<StatsRow>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE excluded = false) AS active,
            COUNT(*) FILTER (WHERE excluded = true) AS excluded_count,
            COALESCE(AVG(char_length(body)) FILTER (WHERE excluded = false), 0)::int AS avg_len,
            COALESCE(
              json_agg(DISTINCT platform_id) FILTER (WHERE platform_id IS NOT NULL),
              '[]'
            )::text AS platforms
       FROM voice_samples`,
  );

  const stats = {
    total: Number(rows[0].total),
    active: Number(rows[0].active),
    excluded: Number(rows[0].excluded_count),
    avgLength: Number(rows[0].avg_len),
    platforms: JSON.parse(rows[0].platforms) as string[],
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bs-label">Writing Corpus</div>
      <h1 className="text-2xl font-semibold text-[var(--text)] mt-1 mb-1">Writing Samples</h1>
      <p className="text-sm text-[var(--text-dim)] mb-6">
        {stats.active} active samples ({stats.excluded} excluded) &middot; avg {stats.avgLength} chars
      </p>
      <VoiceCuration initialStats={stats} />
    </div>
  );
}
