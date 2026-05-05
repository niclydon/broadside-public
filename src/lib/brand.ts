import { cookies, headers } from 'next/headers';
import { query } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('brand');

export type Brand = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  audience_description: string | null;
  accent_color: string;
  display_font: string;
  pillars: string[];
  sort_order: number;
};

const COOKIE_NAME = 'broadside_brand';
const DEFAULT_BRAND_SLUG = 'studio';
const DEFAULT_ACTOR = 'human:operator';

const CACHE_TTL_MS = 10_000;
let cache: { at: number; rows: Brand[] } | null = null;

function rowToBrand(r: Record<string, unknown>): Brand {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    tagline: (r.tagline as string | null) ?? null,
    audience_description: (r.audience_description as string | null) ?? null,
    accent_color: String(r.accent_color),
    display_font: String(r.display_font),
    pillars: Array.isArray(r.pillars) ? (r.pillars as string[]) : [],
    sort_order: Number(r.sort_order ?? 100),
  };
}

export async function getAllBrands(): Promise<Brand[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const stop = logger.time('getAllBrands');
  try {
    const { rows } = await query(
      `SELECT id, slug, name, tagline, audience_description,
              accent_color, display_font, pillars, sort_order
         FROM brands
        ORDER BY sort_order, slug`,
    );
    const brands = rows.map(rowToBrand);
    cache = { at: Date.now(), rows: brands };
    logger.logVerbose('Loaded brands:', brands.length);
    stop();
    return brands;
  } catch (err) {
    stop();
    logger.logMinimal('getAllBrands failed:', (err as Error).message);
    return [];
  }
}

export function invalidateBrandCache(): void {
  cache = null;
}

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  const all = await getAllBrands();
  return all.find((b) => b.slug === slug) ?? null;
}

export async function getBrandById(id: string): Promise<Brand | null> {
  const all = await getAllBrands();
  return all.find((b) => b.id === id) ?? null;
}

/**
 * Resolve the active brand for the current request.
 * Precedence: X-Broadside-Brand header → cookie → DEFAULT_BRAND_SLUG.
 * Falls back to the first brand if the default slug is missing.
 */
export async function currentBrand(): Promise<Brand> {
  const brands = await getAllBrands();
  if (brands.length === 0) {
    throw new Error('No brands configured — run migration 014-brands.sql');
  }

  const hdr = await headers();
  const headerSlug = hdr.get('x-broadside-brand');
  if (headerSlug) {
    const b = brands.find((x) => x.slug === headerSlug);
    if (b) return b;
    logger.logVerbose('Unknown X-Broadside-Brand header value:', headerSlug);
  }

  const cookieStore = await cookies();
  const cookieSlug = cookieStore.get(COOKIE_NAME)?.value;
  if (cookieSlug) {
    const b = brands.find((x) => x.slug === cookieSlug);
    if (b) return b;
  }

  return brands.find((b) => b.slug === DEFAULT_BRAND_SLUG) ?? brands[0];
}

/**
 * Actor identity for write provenance. Agents set X-Broadside-Actor to
 * `agent:<id>` when calling through MCP; human writes default to 'human:operator'.
 */
export async function currentActor(): Promise<string> {
  const hdr = await headers();
  const headerActor = hdr.get('x-broadside-actor');
  if (headerActor && /^(human|agent|system):[\w.-]+$/.test(headerActor)) {
    return headerActor;
  }
  return DEFAULT_ACTOR;
}

export const BRAND_COOKIE_NAME = COOKIE_NAME;
