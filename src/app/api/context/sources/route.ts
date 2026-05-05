import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { rows } = await query<{
    id: string;
    kind: string;
    name: string;
    path: string | null;
    enabled: boolean;
    last_synced_at: string | null;
    item_count: string;
  }>(
    `SELECT cs.id, cs.kind, cs.name, cs.path, cs.enabled, cs.last_synced_at,
            (SELECT COUNT(*)::text FROM context_items ci WHERE ci.source_id = cs.id) AS item_count
       FROM context_sources cs
      ORDER BY cs.kind, cs.name`,
  );
  return NextResponse.json({ sources: rows });
}
