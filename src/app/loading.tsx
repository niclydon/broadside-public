export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <div className="w-4 h-4 border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
        Loading…
      </div>
    </div>
  );
}
