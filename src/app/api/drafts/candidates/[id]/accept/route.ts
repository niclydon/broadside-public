import { NextResponse } from 'next/server';
import { acceptDraftCandidate } from '@/lib/drafts/accept';
import { uuidSchema } from '@/lib/validation';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/drafts/accept');

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  try {
    const result = await acceptDraftCandidate(id);
    return NextResponse.json(result);
  } catch (err) {
    logger.logMinimal('accept failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
