import pg from 'pg';
import { createLogger } from '@/lib/logger';

const logger = createLogger('db');

let pool: pg.Pool | null = null;
let readerPool: pg.Pool | null = null;

/** Broadside's own database (read-write). */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    pool = new pg.Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      logger.logMinimal('Unexpected broadside pool error:', err.message);
    });

    logger.log('broadside pool created');
  }

  return pool;
}

/** Read-only pool against an optional shared context warehouse. */
export function getWarehouseReaderPool(): pg.Pool {
  if (!readerPool) {
    const connectionString = process.env.WAREHOUSE_READONLY_DATABASE_URL;
    if (!connectionString) {
      throw new Error('WAREHOUSE_READONLY_DATABASE_URL environment variable is required');
    }

    readerPool = new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    readerPool.on('error', (err) => {
      logger.logMinimal('Unexpected warehouse-reader pool error:', err.message);
    });

    logger.log('warehouse-reader pool created');
  }

  return readerPool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const stop = logger.time('query');
  try {
    const result = await getPool().query<T>(text, params);
    stop();
    logger.logDebug('Query:', text.slice(0, 200), '| rows:', result.rowCount);
    return result;
  } catch (err) {
    stop();
    logger.logMinimal('Query error:', (err as Error).message);
    logger.logDebug('Failed query:', text);
    throw err;
  }
}

export async function readerQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const stop = logger.time('reader-query');
  try {
    const result = await getWarehouseReaderPool().query<T>(text, params);
    stop();
    logger.logDebug('warehouseReader query:', text.slice(0, 200), '| rows:', result.rowCount);
    return result;
  } catch (err) {
    stop();
    logger.logMinimal('warehouseReader query error:', (err as Error).message);
    logger.logDebug('Failed query:', text);
    throw err;
  }
}

export async function shutdown(): Promise<void> {
  if (pool) {
    logger.log('Shutting down broadside pool');
    await pool.end();
    pool = null;
  }
  if (readerPool) {
    logger.log('Shutting down warehouse-reader pool');
    await readerPool.end();
    readerPool = null;
  }
}
