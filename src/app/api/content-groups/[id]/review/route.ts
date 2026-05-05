import { NextResponse } from 'next/server';
import { evaluateGroup, type ReviewProvider, type GroupPostInput } from '@/lib/review/evaluate';
import { createLogger } from '@/lib/logger';
import { z } from 'zod';

const logger = createLogger('api/content-groups/review');

export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  posts: z.array(z.object({
    platform: z.string(),
    title: z.string().nullable().optional(),
    body: z.string().min(1),
    hashtags: z.array(z.string()).optional(),
  })).min(1),
  provider: z.enum(['anthropic', 'openai', 'gemini', 'deepseek', 'grok']).default('anthropic'),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  logger.log(`group review requested for ${id.slice(0, 8)}`);

  let raw: unknown = {};
  try {
    const txt = await req.text();
    raw = txt ? JSON.parse(txt) : {};
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await evaluateGroup({
      posts: parsed.data.posts as GroupPostInput[],
      provider: parsed.data.provider as ReviewProvider,
      traceId: id,
    });

    return NextResponse.json({
      review: result.review,
      provider: result.provider,
      model: result.model,
      cost_usd: result.cost_usd,
      tokens: result.tokens,
    });
  } catch (err) {
    logger.logMinimal('group review failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
