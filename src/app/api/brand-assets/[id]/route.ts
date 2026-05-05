import { NextResponse } from 'next/server';
import {
  getBrandAsset,
  updateBrandAsset,
  softDeleteBrandAsset,
  hardDeleteBrandAsset,
} from '@/lib/brand-assets';
import { uuidSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';
import { z } from 'zod';

const logger = createLogger('api/brand-assets/[id]');

export const dynamic = 'force-dynamic';

const updateSchema = z
  .object({
    alt_text: z.string().max(2000).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    platform: z.string().max(60).nullable().optional(),
    use_case: z.string().max(60).optional(),
    brand_id: z.string().uuid().nullable().optional(),
    is_current: z.boolean().optional(),
    filename: z.string().max(200).optional(),
    url: z.string().url().nullable().optional(),
  })
  .strict();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const asset = await getBrandAsset(id);
  if (!asset) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ asset });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const asset = await updateBrandAsset(id, parsed.data);
    if (!asset) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ asset });
  } catch (err) {
    logger.logMinimal('update failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/brand-assets/{id}
 *
 * Soft-deletes by default (sets deleted_at, unsets is_current; object stays
 * in backing storage and the row is recoverable). Pass ?hard=true to
 * permanently remove both DB row and object.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const hard = searchParams.get('hard') === 'true';

  try {
    const ok = hard ? await hardDeleteBrandAsset(id) : await softDeleteBrandAsset(id);
    if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, mode: hard ? 'hard' : 'soft' });
  } catch (err) {
    logger.logMinimal('delete failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
