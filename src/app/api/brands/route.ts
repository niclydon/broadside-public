import { NextResponse } from 'next/server';
import { getAllBrands, currentBrand } from '@/lib/brand';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/brands');

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [brands, current] = await Promise.all([getAllBrands(), currentBrand()]);
    return NextResponse.json({ brands, current_slug: current.slug });
  } catch (err) {
    logger.logMinimal('GET /api/brands failed:', (err as Error).message);
    return NextResponse.json({ brands: [], current_slug: null, error: (err as Error).message }, { status: 500 });
  }
}
