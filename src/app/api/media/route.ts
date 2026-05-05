import { NextResponse } from 'next/server';
import { listMedia, uploadMedia } from '@/lib/media';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/media');

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get('group_id');
  if (!groupId) {
    return NextResponse.json({ error: 'group_id required' }, { status: 400 });
  }

  try {
    const media = await listMedia(groupId);
    return NextResponse.json({ media });
  } catch (err) {
    logger.logMinimal('list failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const groupId = formData.get('group_id') as string | null;
    const altText = formData.get('alt_text') as string | null;

    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (!groupId) return NextResponse.json({ error: 'group_id required' }, { status: 400 });

    const data = Buffer.from(await file.arrayBuffer());
    const record = await uploadMedia({
      groupId,
      filename: file.name,
      mimeType: file.type,
      data,
      altText: altText ?? undefined,
    });

    return NextResponse.json({ media: record }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    logger.logMinimal('upload failed:', msg);
    if (msg.includes('unsupported') || msg.includes('too large')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
