import { NextResponse } from 'next/server';
import { listPlatforms } from '@/lib/content';

export const dynamic = 'force-dynamic';

export async function GET() {
  const platforms = await listPlatforms();
  return NextResponse.json({ platforms });
}
