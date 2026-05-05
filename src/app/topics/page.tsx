import { listTopics } from '@/lib/content';

export const dynamic = 'force-dynamic';

export default async function TopicsPage() {
  const topics = await listTopics();

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bs-label">Topics</div>
      <h1 className="text-2xl font-semibold text-[var(--text)] mt-1 mb-1">Content themes</h1>
      <p className="text-sm text-[var(--text-dim)] mb-8">
        Curated top-level categories. Per-topic CRUD lands in a later phase — edit seeds via{' '}
        <code className="font-mono text-[var(--text)]">migrations/005-seed.sql</code> for now.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {topics.map((t) => (
          <div key={t.id} className="bs-card p-4">
            <div className="flex items-center gap-3 mb-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: t.color ?? 'var(--accent)' }}
              />
              <div className="text-[var(--text)] font-semibold">{t.name}</div>
              <span className="bs-pill font-mono">{t.slug}</span>
            </div>
            {t.description && (
              <p className="text-sm text-[var(--text-dim)] leading-snug">{t.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
