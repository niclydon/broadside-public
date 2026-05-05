import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import {
  exchangeCodeForTokens,
  getUserInfo,
  storeTokens,
} from '@/lib/linkedin/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/auth/linkedin/callback');

export const dynamic = 'force-dynamic';

/** Build the external-facing base URL from request headers. */
async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'broadside.example';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');
  const baseUrl = await getBaseUrl();

  if (error) {
    logger.logMinimal('LinkedIn OAuth error:', error, errorDesc);
    return NextResponse.redirect(
      `${baseUrl}/settings?linkedin_error=${encodeURIComponent(errorDesc ?? error)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${baseUrl}/settings?linkedin_error=no+code+received`,
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const userInfo = await getUserInfo(tokens.access_token);
    logger.log('LinkedIn user:', userInfo.name, 'sub:', userInfo.sub);

    await storeTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      member_urn: userInfo.sub,
      display_name: userInfo.name,
      scopes: tokens.scope.split(' '),
    });

    logger.log('LinkedIn connected successfully for', userInfo.name);
    return NextResponse.redirect(`${baseUrl}/settings?linkedin_connected=true`);
  } catch (err) {
    logger.logMinimal('LinkedIn OAuth callback failed:', (err as Error).message);
    return NextResponse.redirect(
      `${baseUrl}/settings?linkedin_error=${encodeURIComponent((err as Error).message)}`,
    );
  }
}
