import { NextResponse } from 'next/server';
import { markPostPublished } from '@/lib/content';
import { publishPostSchema, uuidSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/posts/publish');

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: unknown = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = publishPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const post = await markPostPublished(id, parsed.data);
    return NextResponse.json({ post });
  } catch (err) {
    logger.logMinimal('publish failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
