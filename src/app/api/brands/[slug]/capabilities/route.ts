import { NextResponse } from 'next/server';
import { getAllBrands } from '@/lib/brand';
import { query } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/brands/capabilities');

export const dynamic = 'force-dynamic';

interface AccountRow {
  platform: string;
  account_id: string;
  handle: string | null;
  display_name: string | null;
  kind: string;
  enabled: boolean;
}

interface PlatformRow {
  id: string;
  name: string;
  max_title_chars: number | null;
  max_body_chars: number | null;
  supports_media: boolean;
}

/**
 * GET /api/brands/{slug}/capabilities
 *
 * Returns per-platform availability for a brand. The agent uses this BEFORE
 * creating a content group to know which platforms it can actually publish to
 * for the given brand. Avoids creating content for a brand+platform that has
 * no connected account (which would later fail at publish time).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  try {
    const brands = await getAllBrands();
    const brand = brands.find((b) => b.slug === slug);
    if (!brand) {
      return NextResponse.json({ error: `brand not found: ${slug}` }, { status: 404 });
    }

    const [{ rows: accounts }, { rows: platforms }] = await Promise.all([
      query<AccountRow>(
        `SELECT platform, external_id AS account_id, handle, display_name, kind, enabled
           FROM accounts
          WHERE brand_id = $1
          ORDER BY platform, kind`,
        [brand.id],
      ),
      query<PlatformRow>(
        `SELECT id, name, max_title_chars, max_body_chars, supports_media
           FROM platforms
          ORDER BY id`,
      ),
    ]);

    const byPlatform = new Map<string, AccountRow[]>();
    for (const a of accounts) {
      if (!byPlatform.has(a.platform)) byPlatform.set(a.platform, []);
      byPlatform.get(a.platform)!.push(a);
    }

    const platformCapabilities = platforms.map((p) => {
      const accs = byPlatform.get(p.id) ?? [];
      const enabledAccs = accs.filter((a) => a.enabled);
      return {
        platform_id: p.id,
        platform_name: p.name,
        constraints: {
          max_title_chars: p.max_title_chars,
          max_body_chars: p.max_body_chars,
          supports_media: p.supports_media,
        },
        accounts: accs.map((a) => ({
          handle: a.handle,
          display_name: a.display_name,
          kind: a.kind,
          enabled: a.enabled,
        })),
        can_publish: enabledAccs.length > 0,
      };
    });

    return NextResponse.json({
      brand: { id: brand.id, slug: brand.slug, name: brand.name, tagline: brand.tagline },
      platforms: platformCapabilities,
      summary: {
        publishable_platforms: platformCapabilities.filter((p) => p.can_publish).map((p) => p.platform_id),
        unpublishable_platforms: platformCapabilities.filter((p) => !p.can_publish).map((p) => p.platform_id),
      },
    });
  } catch (err) {
    logger.logMinimal('capabilities failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
