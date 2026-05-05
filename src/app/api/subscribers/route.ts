import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/subscribers');

export const dynamic = 'force-dynamic';

interface SubscriberRow {
  id: string;
  email: string;
  name: string | null;
  subscribed_at: string;
  unsubscribed_at: string | null;
  source: string | null;
  notes: string | null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? 'active'; // active | unsubscribed | all

  const pool = getPool();
  const where =
    status === 'active' ? 'WHERE unsubscribed_at IS NULL'
      : status === 'unsubscribed' ? 'WHERE unsubscribed_at IS NOT NULL'
        : '';

  const { rows } = await pool.query<SubscriberRow>(
    `SELECT id, email, name, subscribed_at, unsubscribed_at, source, notes
       FROM newsletter_subscribers ${where}
      ORDER BY subscribed_at DESC`,
  );

  const { rows: stats } = await pool.query<{ active: string; unsubscribed: string; total: string }>(
    `SELECT COUNT(*) FILTER (WHERE unsubscribed_at IS NULL) AS active,
            COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL) AS unsubscribed,
            COUNT(*) AS total
       FROM newsletter_subscribers`,
  );

  return NextResponse.json({
    subscribers: rows,
    stats: {
      active: Number(stats[0].active),
      unsubscribed: Number(stats[0].unsubscribed),
      total: Number(stats[0].total),
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : null;
  const source = typeof body.source === 'string' ? body.source : 'manual';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }

  const pool = getPool();
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO newsletter_subscribers (email, name, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET unsubscribed_at = NULL,
             name = COALESCE(EXCLUDED.name, newsletter_subscribers.name)
       RETURNING id`,
      [email, name, source],
    );
    logger.log(`subscriber added/resubscribed: ${email}`);
    return NextResponse.json({ id: rows[0].id, email });
  } catch (err) {
    logger.logMinimal('add subscriber failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
