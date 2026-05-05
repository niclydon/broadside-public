import { NextResponse } from 'next/server';
import { fetchAllBlueskyEngagement } from '@/lib/bluesky/engagement';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/engagement/refresh');

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const bluesky = await fetchAllBlueskyEngagement();
    logger.log('engagement refresh:', bluesky);
    return NextResponse.json({ bluesky });
  } catch (err) {
    logger.logMinimal('engagement refresh failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
