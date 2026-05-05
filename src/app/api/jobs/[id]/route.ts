import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const { rows } = await query(
    `SELECT id, kind, status, progress_current, progress_total, progress_label,
            params, result, error, started_at, finished_at, created_at
       FROM jobs
      WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ job: rows[0] });
}
