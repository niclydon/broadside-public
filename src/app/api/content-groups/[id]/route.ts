import { NextResponse } from 'next/server';
import {
  archiveContentGroup,
  getContentGroupDetail,
  updateContentGroup,
} from '@/lib/content';
import { updateContentGroupSchema, uuidSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/content-groups/[id]');

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  try {
    const detail = await getContentGroupDetail(id);
    if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ group: detail });
  } catch (err) {
    logger.logMinimal('get failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = updateContentGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await updateContentGroup(id, parsed.data);
    const detail = await getContentGroupDetail(id);
    return NextResponse.json({ group: detail });
  } catch (err) {
    logger.logMinimal('update failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  try {
    await archiveContentGroup(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.logMinimal('archive failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
