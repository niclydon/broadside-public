import { NextResponse } from 'next/server';
import { regenerateWithLinks } from '@/lib/drafts/regenerate';
import { uuidSchema } from '@/lib/validation';
import { BrandPlatformError } from '@/lib/brand-platform-check';
import { createLogger } from '@/lib/logger';
import { z } from 'zod';

const logger = createLogger('api/content-groups/regenerate');

export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  target_platforms: z.array(z.enum(['linkedin', 'substack', 'bluesky', 'twitter'])).min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid group id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await regenerateWithLinks(id, parsed.data.target_platforms);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BrandPlatformError) {
      return NextResponse.json(err.toBody(), { status: 422 });
    }
    const msg = (err as Error).message;
    logger.logMinimal('regenerate failed:', msg);
    if (msg.includes('no published posts') || msg.includes('no matching posts')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
