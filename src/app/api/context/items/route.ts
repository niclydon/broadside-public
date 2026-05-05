import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const kind = url.searchParams.get('kind');
  const sourceId = url.searchParams.get('source_id');
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 500) : 100;

  const params: unknown[] = [];
  const where: string[] = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(`(ci.content ILIKE $${params.length} OR ci.title ILIKE $${params.length})`);
  }
  if (kind) {
    params.push(kind);
    where.push(`ci.kind = $${params.length}`);
  }
  if (sourceId) {
    params.push(sourceId);
    where.push(`ci.source_id = $${params.length}`);
  }

  params.push(limit);

  const { rows } = await query(
    `SELECT ci.id, ci.kind, ci.title, ci.content, ci.metadata, ci.occurred_at,
            ci.ingested_at, cs.kind AS source_kind, cs.name AS source_name,
            (ce.context_item_id IS NOT NULL) AS has_embedding
       FROM context_items ci
       JOIN context_sources cs ON cs.id = ci.source_id
       LEFT JOIN context_embeddings ce ON ce.context_item_id = ci.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY ci.occurred_at DESC NULLS LAST, ci.ingested_at DESC
       LIMIT $${params.length}`,
    params,
  );

  return NextResponse.json({ items: rows, count: rows.length });
}
