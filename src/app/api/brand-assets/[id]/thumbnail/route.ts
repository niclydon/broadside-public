import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { writeFile, readFile, unlink, mkdtemp, rmdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { streamBrandAsset } from '@/lib/brand-assets';
import { uuidSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';

const execFileAsync = promisify(execFile);
const logger = createLogger('api/brand-assets/thumbnail');

export const dynamic = 'force-dynamic';

/**
 * GET /api/brand-assets/{id}/thumbnail
 *
 * For video assets: extracts the first frame with ffmpeg, returns JPEG.
 * For image assets: redirects to /file (browser handles it natively).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const result = await streamBrandAsset(id);
    if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });

    if (!result.mimeType.startsWith('video/')) {
      return NextResponse.redirect(`/api/brand-assets/${id}/file`);
    }

    const ext = extname(result.filename) || '.mp4';
    const tmpDir = await mkdtemp(join(tmpdir(), 'bsthumb-'));
    const inputPath = join(tmpDir, `input${ext}`);
    const outputPath = join(tmpDir, 'thumb.jpg');

    try {
      await writeFile(inputPath, result.data);
      await execFileAsync('ffmpeg', [
        '-i', inputPath,
        '-vframes', '1',
        '-q:v', '3',
        '-vf', 'scale=800:-1',
        outputPath,
      ]);
      const thumb = await readFile(outputPath);
      return new NextResponse(thumb, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(thumb.length),
          'Cache-Control': 'private, max-age=604800',
        },
      });
    } finally {
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
      await rmdir(tmpDir).catch(() => {});
    }
  } catch (err) {
    logger.logMinimal('thumbnail failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
