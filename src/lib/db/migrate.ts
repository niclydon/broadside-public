import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, shutdown } from './pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('migrate');

/** Apply one migration file and record its version. */
async function applyOne(
  pool: ReturnType<typeof getPool>,
  migrationsDir: string,
  file: string,
  version: number,
) {
  logger.log('Applying:', file);
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  const stop = logger.time(file);
  try {
    await pool.query(sql);
  } catch (err) {
    stop();
    throw err;
  }
  // Record the version unconditionally — idempotent ON CONFLICT.
  await pool.query(
    `INSERT INTO broadside_schema_version (version, description) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [version, `auto-recorded by migrate.ts (${file})`],
  );
  stop();
  logger.log('Applied:', file);
}

export async function runMigrations(migrationsDir: string) {
  logger.log('Migrations directory:', migrationsDir);

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    logger.log('No migration files found');
    return;
  }

  const pool = getPool();

  // Check which versions are already applied
  try {
    const result = await pool.query('SELECT version FROM broadside_schema_version ORDER BY version');
    const applied = new Set(result.rows.map((r) => r.version));
    logger.log('Already applied versions:', [...applied].join(', ') || 'none');

    for (const file of files) {
      const versionMatch = file.match(/^(\d+)/);
      if (!versionMatch) continue;

      const version = parseInt(versionMatch[1], 10);
      if (applied.has(version)) {
        logger.logVerbose('Skipping already applied:', file);
        continue;
      }

      await applyOne(pool, migrationsDir, file, version);
    }
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('broadside_schema_version') && message.includes('does not exist')) {
      // First run — apply all migrations
      logger.log('First run — applying all migrations');
      for (const file of files) {
        const versionMatch = file.match(/^(\d+)/);
        if (!versionMatch) continue;
        const version = parseInt(versionMatch[1], 10);
        await applyOne(pool, migrationsDir, file, version);
      }
    } else {
      throw err;
    }
  }

  logger.log('Migrations complete');
}

// When invoked directly via `tsx src/lib/db/migrate.ts` or similar
const isDirectRun = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  // Default migrations directory relative to the repo root
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  runMigrations(migrationsDir)
    .then(() => shutdown())
    .catch((err) => {
      logger.logMinimal('Migration failed:', err);
      process.exit(1);
    });
}
