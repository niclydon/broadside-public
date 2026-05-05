import { NextResponse } from 'next/server';
import { rejectDraftCandidate } from '@/lib/drafts/accept';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  try {
    await rejectDraftCandidate(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
