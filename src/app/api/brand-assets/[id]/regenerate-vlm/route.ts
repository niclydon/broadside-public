import { NextResponse } from 'next/server';
import { regenerateVlmDescription } from '@/lib/brand-assets';
import { uuidSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/brand-assets/regenerate-vlm');

export const dynamic = 'force-dynamic';

/**
 * POST /api/brand-assets/{id}/regenerate-vlm
 *
 * Re-runs the local model gateway VLM (Qwen3-VL-8B) on the asset's bytes and updates
 * vlm_description + vlm_description_generated_at. Useful when:
 *  - The original description timed out at upload time
 *  - The description looks wrong / unhelpful
 *  - The asset's image was edited externally and the description is stale
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const asset = await regenerateVlmDescription(id);
    if (!asset) return NextResponse.json({ error: 'not found or non-image' }, { status: 404 });
    return NextResponse.json({ asset });
  } catch (err) {
    logger.logMinimal('regenerate-vlm failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
