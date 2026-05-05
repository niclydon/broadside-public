import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/subscribers');

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.unsubscribe === true) {
    sets.push(`unsubscribed_at = now()`);
  } else if (body.unsubscribe === false) {
    sets.push(`unsubscribed_at = NULL`);
  }

  if (typeof body.name === 'string') {
    values.push(body.name);
    sets.push(`name = $${values.length}`);
  }
  if (typeof body.notes === 'string') {
    values.push(body.notes);
    sets.push(`notes = $${values.length}`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  values.push(id);
  const { rowCount } = await pool.query(
    `UPDATE newsletter_subscribers SET ${sets.join(', ')} WHERE id = $${values.length}`,
    values,
  );
  if (rowCount === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  logger.logVerbose(`subscriber ${id} updated: ${sets.join(', ')}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPool();
  const { rowCount } = await pool.query(`DELETE FROM newsletter_subscribers WHERE id = $1`, [id]);
  if (rowCount === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  logger.log(`subscriber ${id} deleted`);
  return NextResponse.json({ ok: true });
}
