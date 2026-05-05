import { NextResponse } from 'next/server';
import { streamBrandAsset } from '@/lib/brand-assets';
import { uuidSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/brand-assets/file');

export const dynamic = 'force-dynamic';

/**
 * GET /api/brand-assets/{id}/file
 *
 * Proxies the asset bytes from object storage so the bucket can stay private
 * and URLs are stable (independent of endpoint changes). Sets
 * Content-Disposition with the original filename for download semantics
 * if a downstream client wants to save it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const result = await streamBrandAsset(id);
    if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const data = result.data;
    const total = data.length;
    const rangeHeader = req.headers.get('range');

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : total - 1;
        const chunk = data.slice(start, end + 1);
        return new NextResponse(new Uint8Array(chunk), {
          status: 206,
          headers: {
            'Content-Type': result.mimeType,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(chunk.length),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'max-age=86400',
            'Content-Disposition': `inline; filename="${result.filename.replace(/"/g, '')}"`,
          },
        });
      }
    }

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Length': String(total),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'max-age=86400',
        'Content-Disposition': `inline; filename="${result.filename.replace(/"/g, '')}"`,
      },
    });
  } catch (err) {
    logger.logMinimal('file proxy failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
