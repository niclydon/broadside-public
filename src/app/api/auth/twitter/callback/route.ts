import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { exchangeCodeForTokens, getMe, storeTokens } from '@/lib/twitter/client';
import { query } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/auth/twitter/callback');

export const dynamic = 'force-dynamic';

async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'broadside.example';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

function decodeBrandFromState(state: string | null): string {
  if (!state) return 'studio';
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    return typeof decoded.brand === 'string' ? decoded.brand : 'studio';
  } catch {
    // Old state format was a plain UUID. Fall back to the default brand.
    return 'studio';
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');
  const brand = decodeBrandFromState(state);
  const baseUrl = await getBaseUrl();

  if (error) {
    logger.logMinimal('X OAuth error:', error);
    return NextResponse.redirect(`${baseUrl}/settings?twitter_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/settings?twitter_error=no+code+received`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code, brand);
    const me = await getMe(tokens.access_token);
    logger.log(`X user: ${me.name} @${me.username} (brand: ${brand})`);

    await storeTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      user_id: me.id,
      username: me.username,
      name: me.name,
    }, brand);

    // Update the accounts row external_id with the real Twitter user ID
    await query(
      `UPDATE accounts SET external_id = $1, handle = $2, updated_at = now()
        WHERE brand_id = (SELECT id FROM brands WHERE slug = $3)
          AND platform = 'twitter'`,
      [me.id, `@${me.username}`, brand],
    );

    return NextResponse.redirect(`${baseUrl}/settings?twitter_connected=${encodeURIComponent(brand)}`);
  } catch (err) {
    logger.logMinimal('X OAuth callback failed:', (err as Error).message);
    return NextResponse.redirect(
      `${baseUrl}/settings?twitter_error=${encodeURIComponent((err as Error).message)}`,
    );
  }
}
