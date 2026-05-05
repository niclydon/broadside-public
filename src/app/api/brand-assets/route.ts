import { NextResponse } from 'next/server';
import {
  listBrandAssets,
  createBrandAsset,
  buildCanonicalFilename,
  isValidBrandAssetFilename,
  RECOMMENDED_USE_CASES,
  RECOMMENDED_PLATFORMS,
} from '@/lib/brand-assets';
import { getAllBrands } from '@/lib/brand';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/brand-assets');

export const dynamic = 'force-dynamic';

/**
 * GET /api/brand-assets
 *
 * Query params:
 *   - use_case (string, optional)
 *   - platform (string, optional; pass "null" for platform-neutral)
 *   - brand_id (uuid, optional; pass "null" for brand-neutral)
 *   - is_current (true/false, optional)
 *   - source_label (string, optional)
 *   - include_deleted (true/false, optional)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const useCase = searchParams.get('use_case') ?? undefined;
    const platformRaw = searchParams.get('platform');
    const brandRaw = searchParams.get('brand_id');
    const isCurrentRaw = searchParams.get('is_current');
    const sourceLabel = searchParams.get('source_label') ?? undefined;
    const includeDeleted = searchParams.get('include_deleted') === 'true';

    const assets = await listBrandAssets({
      use_case: useCase,
      platform: platformRaw === 'null' ? null : platformRaw ?? undefined,
      brand_id: brandRaw === 'null' ? null : brandRaw ?? undefined,
      is_current: isCurrentRaw === 'true' ? true : isCurrentRaw === 'false' ? false : undefined,
      source_label: sourceLabel,
      include_deleted: includeDeleted,
    });

    return NextResponse.json({
      assets,
      count: assets.length,
      recommended_use_cases: RECOMMENDED_USE_CASES,
      recommended_platforms: RECOMMENDED_PLATFORMS,
    });
  } catch (err) {
    logger.logMinimal('list failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/brand-assets
 *
 * multipart/form-data:
 *   - file (binary, required)
 *   - use_case (string, required)
 *   - platform (string, optional)
 *   - brand_id (uuid, optional) — UUID; or pass brand_slug instead
 *   - brand_slug (string, optional) — convenience; resolved to brand_id server-side
 *   - alt_text (string, optional)
 *   - notes (string, optional)
 *   - is_current ("true"/"false", optional)
 *   - source_label (string, optional)
 *
 *   Filename strategy — pick ONE:
 *     A) preferred: provide `slug` (and optionally `variant`); server composes
 *        canonical filename per docs/BRAND_ASSET_NAMING.md.
 *     B) provide `filename` directly; must match the convention regex or 422.
 *     C) provide neither; server falls back to slugifying the original
 *        upload filename — must still produce a valid canonical name.
 */
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const file = fd.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

    const useCase = fd.get('use_case') as string | null;
    if (!useCase) return NextResponse.json({ error: 'use_case required' }, { status: 400 });

    // Resolve brand_slug → brand_id if provided
    const brandSlug = (fd.get('brand_slug') as string) || null;
    let brandId: string | null = (fd.get('brand_id') as string) || null;
    if (brandSlug && !brandId) {
      const brands = await getAllBrands();
      const b = brands.find((br) => br.slug === brandSlug);
      if (!b) return NextResponse.json({ error: `brand_slug not found: ${brandSlug}` }, { status: 422 });
      brandId = b.id;
    }

    // Compose filename
    const platform = (fd.get('platform') as string) || null;
    const slug = (fd.get('slug') as string) || null;
    const variant = (fd.get('variant') as string) || null;
    const explicitFilename = (fd.get('filename') as string) || null;

    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
    let resolvedBrandSlug = brandSlug;
    if (brandId && !resolvedBrandSlug) {
      const brands = await getAllBrands();
      resolvedBrandSlug = brands.find((b) => b.id === brandId)?.slug ?? null;
    }

    let filename: string;
    if (slug) {
      filename = buildCanonicalFilename({
        use_case: useCase,
        brand_slug: resolvedBrandSlug,
        platform,
        slug,
        variant,
        ext,
      });
    } else if (explicitFilename) {
      filename = explicitFilename;
    } else {
      // Fall back to slugifying the upload filename
      const stem = file.name.replace(/\.[^.]+$/, '');
      filename = buildCanonicalFilename({
        use_case: useCase,
        brand_slug: resolvedBrandSlug,
        platform,
        slug: stem,
        variant,
        ext,
      });
    }

    if (!isValidBrandAssetFilename(filename)) {
      return NextResponse.json(
        {
          error: 'filename does not match brand-asset naming convention',
          filename,
          convention: '<use_case>__<brand-or-neutral>__<platform-or-multi>__<slug>[__<variant>].<ext>',
          hint: 'See docs/BRAND_ASSET_NAMING.md',
        },
        { status: 422 },
      );
    }

    const data = Buffer.from(await file.arrayBuffer());
    const asset = await createBrandAsset({
      filename,
      data,
      mimeType: file.type || 'application/octet-stream',
      use_case: useCase,
      platform,
      brand_id: brandId,
      alt_text: (fd.get('alt_text') as string) || null,
      notes: (fd.get('notes') as string) || null,
      is_current: fd.get('is_current') === 'true',
      source_label: (fd.get('source_label') as string) || null,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    logger.logMinimal('upload failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
