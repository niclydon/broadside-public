import { listTags } from '@/lib/content';

export const dynamic = 'force-dynamic';

export default async function TagsPage() {
  const tags = await listTags();

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bs-label">Tags</div>
      <h1 className="text-2xl font-semibold text-[var(--text)] mt-1 mb-1">Free-form tags</h1>
      <p className="text-sm text-[var(--text-dim)] mb-8">
        {tags.length === 0
          ? 'No tags yet. Start typing tags in the post editor and they will auto-create here.'
          : `${tags.length} tags across the content queue`}
      </p>

      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span key={t.id} className="bs-pill font-mono">#{t.slug}</span>
        ))}
      </div>
    </div>
  );
}
