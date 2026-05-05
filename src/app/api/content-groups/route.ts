import { NextResponse } from 'next/server';
import { createContentGroup, listContentGroups } from '@/lib/content';
import { createContentGroupSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';
import { currentBrand } from '@/lib/brand';
import { validateBrandPlatforms, BrandPlatformError } from '@/lib/brand-platform-check';
import type { PostStatus } from '@/lib/types';

const logger = createLogger('api/content-groups');

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status') as PostStatus | null;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 1000) : 500;

  try {
    const groups = await listContentGroups({
      status: statusParam ?? undefined,
      limit,
    });
    return NextResponse.json({ groups });
  } catch (err) {
    logger.logMinimal('list failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = createContentGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const brand = await currentBrand();
    await validateBrandPlatforms(brand.id, parsed.data.platform_ids);
    const id = await createContentGroup({ ...parsed.data, brand_id: brand.id });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    if (err instanceof BrandPlatformError) {
      return NextResponse.json(err.toBody(), { status: 422 });
    }
    logger.logMinimal('create failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
