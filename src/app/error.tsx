'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-xl mx-auto text-center py-20">
      <div className="bs-label" style={{ color: 'var(--danger)' }}>Error</div>
      <h1 className="text-3xl font-semibold text-[var(--text)] mt-2 mb-4">
        Something went wrong
      </h1>
      <p className="text-[var(--text-dim)] mb-2">
        The page failed to load — usually a transient database issue.
      </p>
      <p className="text-xs text-[var(--muted)] font-mono mb-6">
        {error.message}
      </p>
      <button onClick={reset} className="bs-btn bs-btn-primary">
        Try again
      </button>
    </div>
  );
}
