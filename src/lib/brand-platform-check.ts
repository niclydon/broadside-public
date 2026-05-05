/**
 * Brand-platform validation — refuses (brand, platform) combinations that
 * have no enabled account in the `accounts` table.
 *
 * Two callers:
 *   - Create-time: POST /api/content-groups, repurposePost(),
 *     regenerateWithLinks(). Validates that every requested platform has an
 *     enabled account for the request's brand.
 *   - Publish-time (defense in depth): per-platform publish routes look up
 *     the post → group → brand and validate the platform.
 *
 * Substack is exempt — publishing is intentionally manual per the
 * architecture, so the agent can write Substack drafts for any brand even
 * without a connected account.
 */
import { query } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('brand-platform-check');

/**
 * Platforms that bypass the brand-account check because publishing is
 * intentionally manual (handled outside Broadside). Add to this set if
 * other platforms join the manual-only category.
 */
export const EXEMPT_PLATFORMS = new Set<string>(['substack', 'linkedin-article']);

export interface InvalidCombo {
  brand_slug: string;
  platform: string;
}

export class BrandPlatformError extends Error {
  constructor(
    public readonly brand_slug: string,
    public readonly invalid_platforms: string[],
  ) {
    super(
      `brand-platform mismatch: brand "${brand_slug}" has no enabled account for platform(s): ${invalid_platforms.join(', ')}`,
    );
    this.name = 'BrandPlatformError';
  }

  /** Body shape returned in 422 responses. */
  toBody(): Record<string, unknown> {
    return {
      error: 'brand-platform mismatch',
      brand_slug: this.brand_slug,
      invalid_platforms: this.invalid_platforms,
      hint: 'call broadside_brand_capabilities to see which platforms this brand can publish to',
    };
  }
}

/**
 * Check that every platform in `platforms` has an enabled account for
 * `brandId`. Throws BrandPlatformError if any combinations are missing.
 *
 * Exempt platforms (e.g. substack) are skipped — they always pass.
 */
export async function validateBrandPlatforms(
  brandId: string,
  platforms: string[],
): Promise<void> {
  // Strip exempt platforms before checking
  const platformsToCheck = platforms.filter((p) => !EXEMPT_PLATFORMS.has(p));
  if (platformsToCheck.length === 0) return;

  const { rows } = await query<{ platform: string }>(
    `SELECT DISTINCT platform FROM accounts
      WHERE brand_id = $1
        AND platform = ANY($2::text[])
        AND enabled = true`,
    [brandId, platformsToCheck],
  );
  const found = new Set(rows.map((r) => r.platform));
  const missing = platformsToCheck.filter((p) => !found.has(p));

  if (missing.length === 0) return;

  // Resolve brand_slug for the error message
  const { rows: brandRows } = await query<{ slug: string }>(
    `SELECT slug FROM brands WHERE id = $1`,
    [brandId],
  );
  const brandSlug = brandRows[0]?.slug ?? brandId;
  logger.log(`reject brand=${brandSlug} platforms=${missing.join(',')}`);
  throw new BrandPlatformError(brandSlug, missing);
}

/**
 * Helper for publish-time routes: look up the post, find its
 * (group → brand_id) and (platform_id), and validate.
 *
 * Returns the post row so the caller can use it for downstream work
 * (most publish handlers need the post anyway).
 */
export async function validatePostBrandPlatform(postId: string): Promise<{
  id: string;
  content_group_id: string;
  platform_id: string;
  status: string;
  brand_id: string | null;
  brand_slug: string | null;
}> {
  const { rows } = await query<{
    id: string;
    content_group_id: string;
    platform_id: string;
    status: string;
    brand_id: string | null;
    brand_slug: string | null;
  }>(
    `SELECT p.id, p.content_group_id, p.platform_id, p.status, cg.brand_id, b.slug AS brand_slug
       FROM posts p
       JOIN content_groups cg ON cg.id = p.content_group_id
       LEFT JOIN brands b ON b.id = cg.brand_id
      WHERE p.id = $1`,
    [postId],
  );
  if (rows.length === 0) {
    throw new Error(`post not found: ${postId}`);
  }
  const post = rows[0];
  if (post.brand_id) {
    await validateBrandPlatforms(post.brand_id, [post.platform_id]);
  }
  return post;
}
