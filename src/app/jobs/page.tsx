import { query } from '@/lib/db/pool';
import { JobList } from '@/components/JobList';

export const dynamic = 'force-dynamic';

interface Job {
  id: string;
  kind: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  progress_current: number | null;
  progress_total: number | null;
  progress_label: string | null;
  result: unknown;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

async function loadJobs(): Promise<Job[]> {
  try {
    const { rows } = await query<Job>(
      `SELECT id, kind, status, progress_current, progress_total, progress_label,
              result, error, started_at, finished_at, created_at
         FROM jobs
        ORDER BY created_at DESC
        LIMIT 50`,
    );
    return rows;
  } catch {
    return [];
  }
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const [jobs, sp] = await Promise.all([loadJobs(), searchParams]);
  const focus = sp.focus;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bs-label">Jobs</div>
      <h1 className="text-2xl font-semibold text-[var(--text)] mt-1 mb-1">Background tasks</h1>
      <p className="text-sm text-[var(--text-dim)] mb-8">
        In-process tasks for ingestion, embedding, and drafting. Pages automatically refresh every 2s while any job is running.
      </p>
      <JobList initialJobs={jobs} focusId={focus} />
    </div>
  );
}
