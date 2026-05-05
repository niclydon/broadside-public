import { NextResponse } from 'next/server';
import { publishScheduledPosts, recycleEvergreenPosts } from '@/lib/scheduler';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/cron/publish');

export const dynamic = 'force-dynamic';

/** Called every minute by the internal scheduler to publish due posts and recycle evergreen content. */
export async function POST() {
  try {
    const [published, recycled] = await Promise.all([
      publishScheduledPosts(),
      recycleEvergreenPosts(),
    ]);

    const result = { ...published, recycled: recycled.recycled };
    if (published.published > 0 || recycled.recycled > 0) {
      logger.log('cron:', result);
    }
    return NextResponse.json(result);
  } catch (err) {
    logger.logMinimal('cron failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Also allow GET for easy manual testing. */
export async function GET() {
  return POST();
}
