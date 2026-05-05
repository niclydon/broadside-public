import { NextResponse } from 'next/server';
import { movePost } from '@/lib/content';
import { movePostSchema, uuidSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/posts/move');

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid post id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = movePostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await movePost(id, parsed.data.target_group_id);
    return NextResponse.json({
      ok: true,
      post_id: result.post.id,
      target_group_id: parsed.data.target_group_id,
      source_group_deleted: result.source_group_deleted,
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.logMinimal('move failed:', msg);

    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes('already has a') || msg.includes('already belongs to')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
