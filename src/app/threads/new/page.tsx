import { ThreadComposer } from '@/components/ThreadComposer';

export const dynamic = 'force-dynamic';

export default function NewThreadPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="bs-label">Threads</div>
      <h1 className="text-2xl font-semibold text-[var(--text)] mt-1 mb-6">Compose a thread</h1>
      <ThreadComposer />
    </div>
  );
}
