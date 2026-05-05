import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { getMedia, getMediaFilePath } from '@/lib/media';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/media/file');

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const record = await getMedia(id);
    if (!record) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    const filePath = getMediaFilePath(record);
    const data = await readFile(filePath);

    return new NextResponse(data, {
      headers: {
        'Content-Type': record.mime_type ?? 'application/octet-stream',
        'Content-Disposition': `inline; filename="${record.filename ?? 'file'}"`,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (err) {
    logger.logMinimal('file serve failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
