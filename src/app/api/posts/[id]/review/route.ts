import { NextResponse } from 'next/server';
import { evaluatePost, type ReviewProvider } from '@/lib/review/evaluate';
import { createLogger } from '@/lib/logger';
import { z } from 'zod';

const logger = createLogger('api/posts/review');

export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  body: z.string().min(1).max(50_000),
  title: z.string().max(200).nullable().optional(),
  platform: z.enum(['linkedin', 'substack', 'bluesky', 'twitter']),
  hashtags: z.array(z.string()).optional(),
  provider: z.enum(['anthropic', 'openai', 'gemini', 'deepseek', 'grok']).default('anthropic'),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  logger.log(`review requested for post ${id.slice(0, 8)}`);

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
    const result = await evaluatePost({
      body: parsed.data.body,
      title: parsed.data.title ?? null,
      platform: parsed.data.platform,
      hashtags: parsed.data.hashtags,
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
    logger.logMinimal('review failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
