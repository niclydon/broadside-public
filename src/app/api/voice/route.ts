import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/voice');

export const dynamic = 'force-dynamic';

interface VoiceSampleRow {
  id: string;
  platform_id: string | null;
  body: string;
  is_published: boolean;
  excluded: boolean;
  source: string | null;
  notes: string | null;
  created_at: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const status = searchParams.get('status'); // 'active' | 'excluded' | 'all'
  const sortBy = searchParams.get('sort') ?? 'length'; // 'length' | 'date'

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (platform) {
      params.push(platform);
      conditions.push(`platform_id = $${params.length}`);
    }

    if (status === 'active') conditions.push('excluded = false');
    else if (status === 'excluded') conditions.push('excluded = true');

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = sortBy === 'date' ? 'created_at DESC' : 'char_length(body) DESC';

    const { rows } = await query<VoiceSampleRow>(
      `SELECT id, platform_id, body, is_published, excluded, source, notes, created_at
         FROM voice_samples ${where}
        ORDER BY ${order}`,
      params,
    );

    // Stats
    const { rows: stats } = await query<{ total: string; active: string; excluded_count: string; avg_len: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE excluded = false) AS active,
              COUNT(*) FILTER (WHERE excluded = true) AS excluded_count,
              COALESCE(AVG(char_length(body)) FILTER (WHERE excluded = false), 0)::int AS avg_len
         FROM voice_samples`,
    );

    return NextResponse.json({
      samples: rows,
      stats: {
        total: Number(stats[0].total),
        active: Number(stats[0].active),
        excluded: Number(stats[0].excluded_count),
        avgLength: Number(stats[0].avg_len),
      },
    });
  } catch (err) {
    logger.logMinimal('list failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
