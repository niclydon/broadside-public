import { NextResponse } from 'next/server';
import { repurposePost } from '@/lib/drafts/repurpose';
import { uuidSchema } from '@/lib/validation';
import { BrandPlatformError } from '@/lib/brand-platform-check';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/posts/repurpose');

export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  target_platforms: z.array(z.enum(['linkedin', 'substack', 'bluesky', 'twitter'])).min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await repurposePost(id, parsed.data.target_platforms);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BrandPlatformError) {
      return NextResponse.json(err.toBody(), { status: 422 });
    }
    logger.logMinimal('repurpose failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
