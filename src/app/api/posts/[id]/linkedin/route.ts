import { NextResponse } from 'next/server';
import { publishToLinkedIn } from '@/lib/linkedin/publish';
import { uuidSchema } from '@/lib/validation';
import { validatePostBrandPlatform, BrandPlatformError } from '@/lib/brand-platform-check';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/posts/linkedin');

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  try {
    await validatePostBrandPlatform(id);
    const result = await publishToLinkedIn(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BrandPlatformError) {
      return NextResponse.json(err.toBody(), { status: 422 });
    }
    logger.logMinimal('publish failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
