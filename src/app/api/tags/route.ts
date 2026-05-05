import { NextResponse } from 'next/server';
import { listTags } from '@/lib/content';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tags = await listTags();
  return NextResponse.json({ tags });
}
