import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;

  const { rows } = await query(
    `SELECT id, kind, status, progress_current, progress_total, progress_label,
            params, result, error, started_at, finished_at, created_at
       FROM jobs
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return NextResponse.json({ jobs: rows });
}
