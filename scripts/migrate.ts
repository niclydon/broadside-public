import path from 'node:path';
import { runMigrations } from '../src/lib/db/migrate';
import { shutdown } from '../src/lib/db/pool';
import { createLogger } from '../src/lib/logger';

const logger = createLogger('migrate-cli');

const migrationsDir = path.resolve(process.cwd(), 'migrations');

runMigrations(migrationsDir)
  .then(() => shutdown())
  .then(() => {
    logger.log('Done');
    process.exit(0);
  })
  .catch((err) => {
    logger.logMinimal('Migration failed:', err);
    process.exit(1);
  });
