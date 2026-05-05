import { NextResponse } from 'next/server';
import { deleteMedia, updateMediaAltText } from '@/lib/media';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/media/[id]');

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const record = await updateMediaAltText(id, body.alt_text ?? null);
    return NextResponse.json({ media: record });
  } catch (err) {
    logger.logMinimal('update failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await deleteMedia(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    logger.logMinimal('delete failed:', msg);
    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
