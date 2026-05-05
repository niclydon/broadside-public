import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isShowcaseDemoEnabled } from '@/lib/showcase';

const ALLOWLIST = [
  '/_next',
  '/favicon.ico',
  '/api/health',
];

export function middleware(req: NextRequest) {
  if (isShowcaseDemoEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (ALLOWLIST.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  return new NextResponse(
    'Broadside public showcase is disabled by default. Set BROADSIDE_SHOWCASE_DEMO=true to run a local demo.',
    { status: 503 },
  );
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};
