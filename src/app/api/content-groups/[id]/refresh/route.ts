import { NextResponse } from 'next/server';
import { refreshFromSource, type RefreshProvider } from '@/lib/drafts/regenerate';
import { uuidSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';
import { z } from 'zod';

const logger = createLogger('api/content-groups/refresh');

export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  source_post_id: z.string().uuid(),
  target_platforms: z.array(z.enum(['linkedin', 'substack', 'bluesky', 'twitter'])).min(1),
  provider: z.enum(['anthropic', 'openai', 'gemini', 'deepseek', 'grok']).default('anthropic'),
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
    const result = await refreshFromSource({
      groupId: id,
      sourcePostId: parsed.data.source_post_id,
      targetPlatformIds: parsed.data.target_platforms,
      provider: parsed.data.provider as RefreshProvider,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    logger.logMinimal('refresh failed:', msg);
    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
