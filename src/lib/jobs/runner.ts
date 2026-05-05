import { randomUUID } from 'node:crypto';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('jobs');

export interface JobContext {
  id: string;
  setProgress(current: number, total: number, label?: string): Promise<void>;
  logger: ReturnType<typeof createLogger>;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

/** Mark any jobs stuck in "running" as failed. Call on service start. */
export async function failStaleJobs(): Promise<void> {
  try {
    const { rowCount } = await getPool().query(
      `UPDATE jobs
          SET status = 'failed',
              error = 'process restarted with job still running',
              finished_at = now()
        WHERE status = 'running'`,
    );
    if (rowCount && rowCount > 0) {
      logger.log(`marked ${rowCount} stale running jobs as failed`);
    }
  } catch (err) {
    logger.logMinimal('failStaleJobs failed:', (err as Error).message);
  }
}

let staleCheckedThisProcess = false;

async function ensureStaleChecked() {
  if (staleCheckedThisProcess) return;
  staleCheckedThisProcess = true;
  await failStaleJobs();
}

/**
 * Create a jobs row, kick off `handler` in the background, and return the job id.
 * The handler runs inside the same Node process (no external worker). If the
 * process dies mid-run, the next call to `ensureStaleChecked` will mark the
 * job failed.
 */
export async function startJob(
  kind: string,
  params: Record<string, unknown>,
  handler: JobHandler,
): Promise<string> {
  await ensureStaleChecked();

  const id = randomUUID();
  const pool = getPool();

  await pool.query(
    `INSERT INTO jobs (id, kind, status, params)
     VALUES ($1, $2, 'running', $3::jsonb)`,
    [id, kind, JSON.stringify(params)],
  );
  await pool.query(`UPDATE jobs SET started_at = now() WHERE id = $1`, [id]);

  const jobLogger = createLogger(`job/${kind}`);
  jobLogger.log(`started ${id}`);

  const ctx: JobContext = {
    id,
    logger: jobLogger,
    async setProgress(current: number, total: number, label?: string) {
      try {
        await pool.query(
          `UPDATE jobs
              SET progress_current = $1,
                  progress_total = $2,
                  progress_label = COALESCE($3, progress_label)
            WHERE id = $4`,
          [current, total, label ?? null, id],
        );
      } catch (err) {
        jobLogger.logMinimal('setProgress failed:', (err as Error).message);
      }
    },
  };

  // Fire and local-model-gatewayt.
  setImmediate(async () => {
    try {
      const result = await handler(ctx);
      await pool.query(
        `UPDATE jobs
            SET status = 'done', finished_at = now(), result = $1::jsonb
          WHERE id = $2`,
        [JSON.stringify(result ?? {}), id],
      );
      jobLogger.log(`done ${id}`);
    } catch (err) {
      const msg = (err as Error).message;
      jobLogger.logMinimal(`failed ${id}:`, msg);
      try {
        await pool.query(
          `UPDATE jobs
              SET status = 'failed', finished_at = now(), error = $1
            WHERE id = $2`,
          [msg, id],
        );
      } catch (dbErr) {
        jobLogger.logMinimal('failed to mark job failed:', (dbErr as Error).message);
      }
    }
  });

  return id;
}
