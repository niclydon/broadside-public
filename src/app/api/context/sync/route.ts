import { NextResponse } from 'next/server';
import { startJob } from '@/lib/jobs/runner';
import { runFullSync } from '@/lib/ingest/sync';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/context/sync');

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const jobId = await startJob('ingest_sync', {}, async (ctx) => {
      return await runFullSync(ctx);
    });
    logger.log('sync job enqueued', jobId);
    return NextResponse.json({ job_id: jobId }, { status: 202 });
  } catch (err) {
    logger.logMinimal('sync kickoff failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
