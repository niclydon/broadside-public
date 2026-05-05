import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthorizationUrl } from '@/lib/linkedin/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/auth/linkedin');

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = randomUUID();
  // In a real multi-user app we'd store state in a session cookie.
  // This showcase keeps the flow simple and passes state through directly.
  const url = getAuthorizationUrl(state);
  logger.log('redirecting to LinkedIn consent');
  return NextResponse.redirect(url);
}
