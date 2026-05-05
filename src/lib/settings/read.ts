import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('settings');

const CACHE_TTL_MS = 10_000;
let cache: { at: number; map: Map<string, unknown> } | null = null;

async function loadAll(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
  try {
    const { rows } = await getPool().query<{ key: string; value: unknown }>(
      `SELECT key, value FROM settings`,
    );
    const map = new Map<string, unknown>();
    for (const r of rows) map.set(r.key, r.value);
    cache = { at: Date.now(), map };
    return map;
  } catch (err) {
    logger.logMinimal('settings load failed:', (err as Error).message);
    return new Map();
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const map = await loadAll();
  const v = map.get(key);
  return (v ?? fallback) as T;
}

export function invalidateSettingsCache(): void {
  cache = null;
}
