import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { runFullSync } from '@/lib/ingest/sync';
import { getSetting } from '@/lib/settings/read';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/cron/sync');

export const dynamic = 'force-dynamic';

/**
 * Auto-sync cron: re-ingests context if enough time has passed since last sync.
 * Checks `ingest.auto_sync_interval_hours` (default 6) and skips if any source
 * was synced more recently.
 */
export async function POST() {
  try {
    const intervalHours = await getSetting<number>('ingest.auto_sync_interval_hours', 6);
    if (intervalHours <= 0) {
      logger.logVerbose('auto-sync disabled (interval=0)');
      return NextResponse.json({ skipped: true, reason: 'disabled' });
    }

    // Check if any source was synced within the interval
    const pool = getPool();
    const { rows } = await pool.query<{ most_recent: string | null }>(
      `SELECT MAX(last_synced_at) AS most_recent FROM context_sources`,
    );
    const lastSync = rows[0]?.most_recent ? new Date(rows[0].most_recent) : null;
    const thresholdMs = intervalHours * 60 * 60 * 1000;

    if (lastSync && Date.now() - lastSync.getTime() < thresholdMs) {
      const agoMin = Math.round((Date.now() - lastSync.getTime()) / 60_000);
      logger.logVerbose(`auto-sync skipped: last sync ${agoMin}m ago (threshold ${intervalHours}h)`);
      return NextResponse.json({ skipped: true, reason: 'recent', last_sync_minutes_ago: agoMin });
    }

    logger.log('auto-sync starting');
    const result = await runFullSync();
    logger.log('auto-sync complete:', result);
    return NextResponse.json({ synced: true, result });
  } catch (err) {
    logger.logMinimal('auto-sync failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Allow GET for easy manual testing. */
export async function GET() {
  return POST();
}
