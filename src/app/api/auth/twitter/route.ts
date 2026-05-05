import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthorizationUrl } from '@/lib/twitter/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/auth/twitter');

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const brand = url.searchParams.get('brand') ?? 'studio';
  // Encode brand in state so the callback knows which token key to write
  const state = Buffer.from(JSON.stringify({ id: randomUUID(), brand })).toString('base64url');
  const authUrl = getAuthorizationUrl(state, brand);
  logger.log(`redirecting to X consent for brand: ${brand}`);
  return NextResponse.redirect(authUrl);
}
