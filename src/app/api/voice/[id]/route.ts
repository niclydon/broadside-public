import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/voice');

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const sets: string[] = [];
  const values: unknown[] = [];

  if (typeof body.excluded === 'boolean') {
    values.push(body.excluded);
    sets.push(`excluded = $${values.length}`);
  }
  if (typeof body.notes === 'string') {
    values.push(body.notes);
    sets.push(`notes = $${values.length}`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  values.push(id);
  try {
    const { rowCount } = await query(
      `UPDATE voice_samples SET ${sets.join(', ')} WHERE id = $${values.length}`,
      values,
    );
    if (rowCount === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    logger.logVerbose(`updated sample ${id}:`, sets.join(', '));
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.logMinimal('update failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { rowCount } = await query(`DELETE FROM voice_samples WHERE id = $1`, [id]);
    if (rowCount === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    logger.log(`deleted voice sample ${id}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.logMinimal('delete failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
