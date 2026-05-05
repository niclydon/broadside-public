import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending'; // pending | accepted | rejected | all
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 500) : 100;

  const where: string[] = [];
  const params: unknown[] = [];
  if (status === 'pending') {
    where.push('NOT dc.accepted AND NOT dc.rejected');
  } else if (status === 'accepted') {
    where.push('dc.accepted');
  } else if (status === 'rejected') {
    where.push('dc.rejected');
  }
  params.push(limit);

  const { rows } = await query(
    `SELECT
       dc.id, dc.generation_id, dc.topic_slug, dc.hook, dc.body, dc.rationale,
       dc.cited_item_ids, dc.accepted, dc.rejected, dc.content_group_id, dc.created_at,
       dg.model AS generation_model, dg.cost_usd AS generation_cost
     FROM draft_candidates dc
     JOIN draft_generations dg ON dg.id = dc.generation_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY dc.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return NextResponse.json({ candidates: rows });
}
