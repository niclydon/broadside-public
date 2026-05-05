import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="max-w-xl mx-auto text-center py-20">
      <div className="bs-label">404</div>
      <h1 className="text-3xl font-semibold text-[var(--text)] mt-2 mb-4">Not found</h1>
      <p className="text-[var(--text-dim)] mb-6">That content group doesn&apos;t exist or was archived.</p>
      <Link href="/" className="bs-btn bs-btn-primary inline-flex">
        Back to queue
      </Link>
    </div>
  );
}
