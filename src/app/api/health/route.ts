import { NextResponse } from 'next/server';
import { query, readerQuery } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/health');

export const dynamic = 'force-dynamic';

type CheckResult = { ok: true; detail?: string } | { ok: false; error: string };

async function checkBroadsideDb(): Promise<CheckResult> {
  try {
    const result = await query<{ version: number | null }>(
      `SELECT MAX(version) AS version FROM broadside_schema_version`,
    );
    const v = result.rows[0]?.version;
    return { ok: true, detail: v === null ? 'no migrations applied' : `schema v${v}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function checkWarehouseReader(): Promise<CheckResult> {
  if (!process.env.WAREHOUSE_READONLY_DATABASE_URL) {
    return { ok: false, error: 'WAREHOUSE_READONLY_DATABASE_URL not set' };
  }
  try {
    const result = await readerQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM knowledge_facts`,
    );
    return { ok: true, detail: `${result.rows[0]?.count} knowledge_facts` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function checkLocalModelGateway(): Promise<CheckResult> {
  const base = process.env.LOCAL_MODEL_GATEWAY_BASE_URL;
  const key = process.env.LOCAL_MODEL_GATEWAY_API_KEY;
  if (!base || !key) {
    return { ok: false, error: 'LOCAL_MODEL_GATEWAY_BASE_URL / LOCAL_MODEL_GATEWAY_API_KEY not set' };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${base.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 503) {
      return { ok: true, detail: 'creative mode (fallback: openai)' };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, detail: `${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function checkAnthropic(): Promise<CheckResult> {
  // Presence check only — no API call to avoid billing a probe.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY not set' };
  if (!key.startsWith('sk-ant-')) return { ok: false, error: 'looks malformed' };
  return { ok: true, detail: 'key present' };
}

async function checkOpenAI(): Promise<CheckResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: 'OPENAI_API_KEY not set (embedding fallback unavailable)' };
  return { ok: true, detail: 'key present' };
}

export async function GET() {
  const stop = logger.time('health');
  const [db, warehouseReader, localModelGateway, anthropic, openai] = await Promise.all([
    checkBroadsideDb(),
    checkWarehouseReader(),
    checkLocalModelGateway(),
    checkAnthropic(),
    checkOpenAI(),
  ]);
  stop();

  const allOk = db.ok && warehouseReader.ok && localModelGateway.ok && anthropic.ok && openai.ok;
  const payload = {
    ok: allOk,
    service: 'broadside',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    checks: { db, warehouseReader, localModelGateway, anthropic, openai },
  };

  if (!allOk) {
    logger.log(
      'health not ok:',
      Object.entries(payload.checks)
        .filter(([, v]) => !v.ok)
        .map(([k]) => k)
        .join(', '),
    );
  }

  return NextResponse.json(payload, { status: allOk ? 200 : 503 });
}
