import { NextResponse } from 'next/server';
import { listTopics } from '@/lib/content';

export const dynamic = 'force-dynamic';

export async function GET() {
  const topics = await listTopics();
  return NextResponse.json({ topics });
}
