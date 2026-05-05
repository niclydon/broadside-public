import type { Metadata } from 'next';
import { query } from '@/lib/db/pool';
import { SuggestionsInbox } from '@/components/SuggestionsInbox';

export const metadata: Metadata = { title: 'Suggestions — Broadside' };
export const dynamic = 'force-dynamic';

interface CandidateRow {
  id: string;
  generation_id: string;
  topic_slug: string | null;
  hook: string | null;
  body: string;
  rationale: string | null;
  cited_item_ids: string[];
  accepted: boolean;
  rejected: boolean;
  content_group_id: string | null;
  created_at: string;
  generation_model: string | null;
  generation_cost: string | null;
}

async function loadPending(): Promise<CandidateRow[]> {
  try {
    const { rows } = await query<CandidateRow>(
      `SELECT dc.id, dc.generation_id, dc.topic_slug, dc.hook, dc.body, dc.rationale,
              dc.cited_item_ids, dc.accepted, dc.rejected, dc.content_group_id, dc.created_at,
              dg.model AS generation_model, dg.cost_usd::text AS generation_cost
         FROM draft_candidates dc
         JOIN draft_generations dg ON dg.id = dc.generation_id
        WHERE NOT dc.accepted AND NOT dc.rejected
        ORDER BY dc.created_at DESC
        LIMIT 100`,
    );
    return rows;
  } catch {
    return [];
  }
}

async function loadCounts() {
  try {
    const { rows } = await query<{ pending: string; accepted: string; rejected: string; total_cost: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM draft_candidates WHERE NOT accepted AND NOT rejected) AS pending,
         (SELECT COUNT(*)::text FROM draft_candidates WHERE accepted) AS accepted,
         (SELECT COUNT(*)::text FROM draft_candidates WHERE rejected) AS rejected,
         (SELECT COALESCE(SUM(cost_usd), 0)::text FROM draft_generations) AS total_cost`,
    );
    return rows[0];
  } catch {
    return { pending: '0', accepted: '0', rejected: '0', total_cost: '0' };
  }
}

export default async function SuggestionsPage() {
  const [candidates, counts] = await Promise.all([loadPending(), loadCounts()]);
  const cost = parseFloat(counts.total_cost ?? '0');

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="bs-label">Suggestions</div>
          <h1 className="text-2xl font-semibold text-[var(--text)] mt-1">AI draft inbox</h1>
          <p className="text-sm text-[var(--text-dim)] mt-1">
            {counts.pending} pending · {counts.accepted} accepted · {counts.rejected} rejected ·{' '}
            <span className="font-mono">${cost.toFixed(2)} spent</span>
          </p>
        </div>
      </div>

      <SuggestionsInbox initialCandidates={candidates} />
    </div>
  );
}
