import crypto from 'node:crypto';
import { getWarehouseReaderPool } from '@/lib/db/pool';
import { scrubSecrets } from './scrub';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ingest/shared-warehouse');

export interface WarehouseItem {
  externalId: string;
  kind: 'shared-warehouse_fact' | 'shared-warehouse_insight' | 'shared-warehouse_summary' | 'shared-warehouse_behavioral' | 'calendar_event' | 'silver' | 'gold';
  title: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  occurredAt?: Date;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Domains most relevant for content creation (security, infra, AI, tech).
// Facts from these domains get priority; others still included but ranked lower.
const CONTENT_RELEVANT_DOMAINS = new Set([
  'technology', 'security', 'ai', 'infrastructure', 'programming',
  'machine_learning', 'software', 'engineering', 'research',
]);

/**
 * Read knowledge_facts with content-relevance weighting and rotating window.
 * Prefers content-relevant domains and facts not already ingested.
 * @param limit Max facts to return
 * @param existingIds External IDs already in context_items (for rotation)
 */
export async function readKnowledgeFacts(limit: number, existingIds?: Set<string>): Promise<WarehouseItem[]> {
  const pool = getWarehouseReaderPool();
  try {
    // Fetch more than limit to allow filtering + rotation
    const fetchLimit = existingIds?.size ? limit * 3 : limit;
    const { rows } = await pool.query<{
      id: string;
      domain: string | null;
      category: string | null;
      key: string | null;
      value: string | null;
      confidence: number | null;
      sources: string[] | null;
      created_at: string;
    }>(
      `SELECT id, domain, category, key, value, confidence, sources, created_at
         FROM knowledge_facts
        WHERE superseded_by IS NULL
          AND value IS NOT NULL
          AND value <> ''
          AND (human_rejected_at IS NULL)
        ORDER BY COALESCE(confidence, 0) DESC, created_at DESC
        LIMIT $1`,
      [fetchLimit],
    );
    logger.log(`knowledge_facts: ${rows.length} raw rows (limit=${limit})`);

    const allItems = rows.map((r) => {
      const titleParts = [r.domain, r.category, r.key].filter(Boolean).join(' · ');
      const rawContent = `${titleParts}\n${r.value ?? ''}`;
      const scrubbed = scrubSecrets(rawContent);
      return {
        externalId: r.id,
        kind: 'shared-warehouse_fact' as const,
        title: titleParts || '(fact)',
        content: scrubbed.text,
        contentHash: sha256(scrubbed.text),
        metadata: {
          confidence: r.confidence,
          sources: r.sources ?? [],
          domain: r.domain,
          category: r.category,
        },
        occurredAt: new Date(r.created_at),
        _isRelevantDomain: CONTENT_RELEVANT_DOMAINS.has((r.domain ?? '').toLowerCase()),
        _alreadyIngested: existingIds?.has(r.id) ?? false,
      };
    });

    // Prioritize: new items from relevant domains first, then new from other
    // domains, then already-ingested items (for rotation)
    allItems.sort((a, b) => {
      // Prefer not-yet-ingested
      if (a._alreadyIngested !== b._alreadyIngested) return a._alreadyIngested ? 1 : -1;
      // Then prefer content-relevant domains
      if (a._isRelevantDomain !== b._isRelevantDomain) return a._isRelevantDomain ? -1 : 1;
      return 0; // preserve existing confidence+recency ordering
    });

    return allItems.slice(0, limit).map(({ _isRelevantDomain, _alreadyIngested, ...item }) => item);
  } catch (err) {
    logger.logMinimal('knowledge_facts read failed:', (err as Error).message);
    return [];
  }
}

export async function readProactiveInsights(limit: number): Promise<WarehouseItem[]> {
  const pool = getWarehouseReaderPool();
  try {
    // We don't know this table's schema in advance — introspect and pick sensible columns.
    const { rows: cols } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_name = 'proactive_insights'
          AND table_schema = 'public'`,
    );
    const colSet = new Set(cols.map((c) => c.column_name));
    if (colSet.size === 0) {
      logger.logVerbose('proactive_insights has no columns — skipping');
      return [];
    }

    // Pick what we need, safely. created_at is typical; text/content/summary/description for body.
    const hasCreatedAt = colSet.has('created_at');
    const bodyCol = ['content', 'text', 'body', 'summary', 'description'].find((c) => colSet.has(c));
    const idCol = colSet.has('id') ? 'id' : null;
    if (!bodyCol || !idCol) {
      logger.logVerbose(
        `proactive_insights missing expected columns (has=${Array.from(colSet).join(',')}) — skipping`,
      );
      return [];
    }

    const orderClause = hasCreatedAt ? 'ORDER BY created_at DESC' : '';
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM proactive_insights ${orderClause} LIMIT $1`,
      [limit],
    );

    return rows.map((r) => {
      const id = String(r[idCol] ?? '');
      const body = String(r[bodyCol] ?? '');
      const createdAt = hasCreatedAt && r.created_at ? new Date(r.created_at as string) : undefined;
      const title =
        (r.title as string) ||
        (r.headline as string) ||
        body.split('\n')[0]?.slice(0, 120) ||
        '(insight)';
      const scrubbed = scrubSecrets(`${title}\n${body}`);
      return {
        externalId: id,
        kind: 'shared-warehouse_insight' as const,
        title,
        content: scrubbed.text,
        contentHash: sha256(scrubbed.text),
        metadata: { source: 'proactive_insights' },
        occurredAt: createdAt,
      };
    });
  } catch (err) {
    logger.logMinimal('proactive_insights read failed:', (err as Error).message);
    return [];
  }
}

// Preferred timestamp column names — checked first as a fast path. If none match, planView falls
// back to type-based detection (any column with a timestamp/timestamptz/date type qualifies).
const TS_COL_CANDIDATES = [
  'timestamp', 'occurred_at', 'created_at',
  'start_time', 'played_at', 'analyzed_at', 'scrobbled_at',
  'watched_date', 'transaction_date', 'recorded_at', 'date',
];

const CLAUDE_CONTENT_COL_CANDIDATES = [
  'content', 'content_text', 'text', 'body', 'summary', 'message', 'response',
  'assistant_content', 'user_content',
];

interface DiscoveredView {
  schema: string;
  name: string;
}

interface ViewPlan {
  view: DiscoveredView;
  tsCol: string;
}

/**
 * Discover and ingest from shared-warehouse Silver (`warehouse_*_normalized`)
 * and Gold (`warehouse_unified_*`) views.
 *
 * Discovery is name-pattern based — anything matching the pattern in shared-warehouse is picked up automatically.
 * Per-view error containment: a missing view, missing GRANT, or unexpected schema logs a warning
 * and the loop continues with the other views.
 */
export async function readSilverGold(opts: {
  perViewLimit: number;
  defaultDays: number;
  viewLimits?: Map<string, number>;
}): Promise<WarehouseItem[]> {
  const pool = getWarehouseReaderPool();
  let views: DiscoveredView[];
  try {
    // Use pg_class directly: information_schema.views is privilege-filtered (a view broadside_reader
    // lacks SELECT on is silently absent), and information_schema doesn't list matviews at all.
    // pg_class.relkind 'v' = view, 'm' = matview — covers both tiers in one query and finds them
    // regardless of grant state, so missing-grant cases reach planView() and log loud warnings.
    const { rows } = await pool.query<{ schema: string; name: string }>(
      `SELECT n.nspname AS schema, c.relname AS name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('v', 'm')
          AND (c.relname LIKE 'warehouse\\_%\\_normalized' ESCAPE '\\'
            OR c.relname LIKE 'warehouse\\_unified\\_%' ESCAPE '\\')
        ORDER BY c.relname`,
    );
    views = rows;
  } catch (err) {
    logger.logMinimal('Silver/Gold discovery failed:', (err as Error).message);
    return [];
  }
  logger.log(`Silver/Gold: discovered ${views.length} views`);

  const items: WarehouseItem[] = [];
  for (const v of views) {
    const planned = await planView(pool, v);
    if (!planned) continue;
    const { tsCol } = planned;
    const isGold = v.name.startsWith('warehouse_unified_');
    const kind: WarehouseItem['kind'] = isGold ? 'gold' : 'silver';
    const viewLimit = opts.viewLimits?.get(v.name) ?? opts.perViewLimit;

    try {
      // Row-rendering strategy: deterministically convert each row into "key: value\n..." lines via
      // jsonb_each_text on (to_jsonb(t.*) - tsCol). Captures any view shape — text-heavy
      // (communication, ai_conversations) AND structural (health, location, calls) — without
      // needing per-view content-column hardcoding. Stable id derived from md5 of the JSON
      // representation so identical rows dedupe across syncs.
      const sql = `
        SELECT md5(to_jsonb(t.*)::text) AS row_id,
               ${tsCol} AS occurred_at,
               (
                 SELECT string_agg(format('%s: %s', kv.key, kv.value), E'\n' ORDER BY kv.key)
                   FROM jsonb_each_text(to_jsonb(t.*) - $3::text) kv
                  WHERE kv.value IS NOT NULL AND kv.value <> ''
               ) AS content,
               to_jsonb(t.*) AS payload
          FROM ${v.schema}.${v.name} t
         WHERE ${tsCol} IS NOT NULL
           AND ${tsCol} >= now() - ($1 || ' days')::interval
         ORDER BY ${tsCol} DESC
         LIMIT $2
      `;
      const { rows } = await pool.query<{
        row_id: string;
        occurred_at: string;
        content: string | null;
        payload: Record<string, unknown>;
      }>(sql, [opts.defaultDays, viewLimit, tsCol]);
      logger.logVerbose(`${v.name}: ${rows.length} rows`);

      for (const r of rows) {
        if (!r.content) continue;
        const scrubbed = scrubSecrets(r.content);
        // Title preference: explicit `title` field if present and non-empty,
        // else first non-empty rendered line, else view name.
        const titleFromPayload = typeof r.payload.title === 'string' && r.payload.title.length > 0
          ? r.payload.title
          : undefined;
        const firstLine = scrubbed.text.split('\n').find((l) => l.trim().length > 0);
        const title = (titleFromPayload || firstLine || v.name).slice(0, 120);
        items.push({
          externalId: `${v.name}:${r.row_id}`,
          kind,
          title,
          content: scrubbed.text,
          contentHash: sha256(scrubbed.text),
          metadata: { 'shared-warehouse_view': v.name, tier: isGold ? 'gold' : 'silver', payload: r.payload },
          occurredAt: new Date(r.occurred_at),
        });
      }
    } catch (err) {
      // Per-view error containment — one bad view (missing GRANT, schema drift, broken matview)
      // does not abort the whole sync.
      logger.log(`${v.name}: read failed — ${(err as Error).message}`);
    }
  }

  logger.log(`Silver/Gold: ${items.length} total items across ${views.length} views`);
  return items;
}

export async function readBehavioralDNA(limit: number): Promise<WarehouseItem[]> {
  const pool = getWarehouseReaderPool();
  try {
    const { rows } = await pool.query<{
      id: number;
      trait: string;
      summary: string | null;
      confidence: number | null;
      evidence_count: number | null;
      last_updated: string;
    }>(
      `SELECT id,
              trait,
              current_value->>'summary' AS summary,
              confidence,
              evidence_count,
              last_updated
         FROM warehouse_behavioral_profiles
        WHERE active = true
        ORDER BY confidence DESC
        LIMIT $1`,
      [limit],
    );
    logger.log(`warehouse_behavioral_profiles: ${rows.length} rows`);

    return rows.map((r) => {
      const content = `${r.trait}\n${r.summary ?? ''}\n(confidence: ${r.confidence}, evidence: ${r.evidence_count} data points)`;
      const scrubbed = scrubSecrets(content);
      return {
        externalId: String(r.id),
        kind: 'shared-warehouse_behavioral' as const,
        title: r.trait,
        content: scrubbed.text,
        contentHash: sha256(scrubbed.text),
        metadata: {
          source: 'warehouse_behavioral_profiles',
          confidence: r.confidence,
          evidence_count: r.evidence_count,
        },
        occurredAt: new Date(r.last_updated),
      };
    });
  } catch (err) {
    logger.logMinimal('warehouse_behavioral_profiles read failed:', (err as Error).message);
    return [];
  }
}

export async function readSilverClaude(): Promise<WarehouseItem[]> {
  const pool = getWarehouseReaderPool();
  const table = { schema: 'public', name: 'warehouse_silver_notes' };
  try {
    const { rows: cols } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS data_type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [table.schema, table.name],
    );
    if (cols.length === 0) {
      logger.log(`${table.name}: no columns visible (likely missing GRANT for broadside_reader) — skipping`);
      return [];
    }

    const colSet = new Set(cols.map((c) => c.column_name));
    const tsCol = TS_COL_CANDIDATES.find((c) => colSet.has(c));
    const contentCol = CLAUDE_CONTENT_COL_CANDIDATES.find((c) => colSet.has(c));
    if (!tsCol || !contentCol) {
      logger.log(
        `${table.name}: missing ${!tsCol ? 'timestamp' : 'content'} column (has=${cols.map((c) => c.column_name).join(',')}) — skipping`,
      );
      return [];
    }

    const { rows } = await pool.query<{
      row_id: string;
      occurred_at: string;
      content: string | null;
      payload: Record<string, unknown>;
    }>(
      `SELECT md5(to_jsonb(t.*)::text) AS row_id,
              ${tsCol} AS occurred_at,
              (
                SELECT string_agg(format('%s: %s', kv.key, kv.value), E'\n' ORDER BY kv.key)
                  FROM jsonb_each_text(to_jsonb(t.*) - $1::text) kv
                 WHERE kv.value IS NOT NULL AND kv.value <> ''
              ) AS content,
              to_jsonb(t.*) AS payload
         FROM ${table.schema}.${table.name} t
        WHERE ${tsCol} IS NOT NULL
          AND ${tsCol} >= now() - interval '60 days'
          AND ${contentCol} IS NOT NULL
          AND ${contentCol}::text <> ''
        ORDER BY ${tsCol} DESC
        LIMIT 200`,
      [tsCol],
    );
    logger.log(`${table.name}: ${rows.length} rows`);

    return rows.flatMap((r) => {
      if (!r.content) return [];
      const scrubbed = scrubSecrets(r.content);
      const titleFromPayload = typeof r.payload.title === 'string' && r.payload.title.length > 0
        ? r.payload.title
        : undefined;
      const firstLine = scrubbed.text.split('\n').find((l) => l.trim().length > 0);
      return [{
        externalId: `${table.name}:${r.row_id}`,
        kind: 'silver' as const,
        title: (titleFromPayload || firstLine || table.name).slice(0, 120),
        content: scrubbed.text,
        contentHash: sha256(scrubbed.text),
        metadata: { 'shared-warehouse_view': table.name, tier: 'silver', payload: r.payload },
        occurredAt: new Date(r.occurred_at),
      }];
    });
  } catch (err) {
    logger.logMinimal(`${table.name} read failed:`, (err as Error).message);
    return [];
  }
}

/** Inspect a view's columns and pick a timestamp axis. Content is rendered generically per-row. */
async function planView(
  pool: ReturnType<typeof getWarehouseReaderPool>,
  view: DiscoveredView,
): Promise<ViewPlan | null> {
  try {
    // Use pg_attribute (covers tables, views, and matviews uniformly — information_schema does
    // not list matview columns). Capture data type alongside name so we can fall back to
    // type-based timestamp detection when none of the candidate names match.
    const { rows: cols } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS data_type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [view.schema, view.name],
    );
    if (cols.length === 0) {
      logger.log(`${view.name}: no columns visible (likely missing GRANT for broadside_reader) — skipping`);
      return null;
    }
    const colSet = new Set(cols.map((c) => c.column_name));

    // Timestamp detection: candidate-name fast path, then type-based fallback (any column with a
    // timestamp/timestamptz/date type qualifies). Picks first match by attribute order.
    let tsCol = TS_COL_CANDIDATES.find((c) => colSet.has(c));
    if (!tsCol) {
      const typedTs = cols.find((c) => /^(timestamp|timestamptz|timestamp with time zone|timestamp without time zone|date)$/i.test(c.data_type));
      if (typedTs) {
        tsCol = typedTs.column_name;
        logger.logVerbose(`${view.name}: using ${tsCol} (${typedTs.data_type}) as timestamp via type fallback`);
      }
    }
    if (!tsCol) {
      logger.log(`${view.name}: no timestamp/date column found — skipping`);
      return null;
    }

    return { view, tsCol };
  } catch (err) {
    logger.log(`${view.name}: plan failed — ${(err as Error).message}`);
    return null;
  }
}

/** Read AI-generated knowledge summaries (domain overviews, patterns, etc). */
export async function readKnowledgeSummaries(limit: number): Promise<WarehouseItem[]> {
  const pool = getWarehouseReaderPool();
  try {
    const { rows: cols } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'knowledge_summaries' AND table_schema = 'public'`,
    );
    const colSet = new Set(cols.map((c) => c.column_name));
    if (!colSet.has('id') || !colSet.has('content')) {
      logger.logVerbose('knowledge_summaries missing expected columns — skipping');
      return [];
    }

    const { rows } = await pool.query<{
      id: string;
      summary_type: string;
      title: string;
      content: string;
      fact_count: number | null;
      stale: boolean;
      created_at: string;
    }>(
      `SELECT id, summary_type, title, content, fact_count, stale, created_at
         FROM knowledge_summaries
        WHERE content IS NOT NULL AND content <> ''
          AND stale = false
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    logger.log(`knowledge_summaries: ${rows.length} rows`);

    return rows.map((r) => {
      const scrubbed = scrubSecrets(`${r.title}\n${r.content}`);
      return {
        externalId: r.id,
        kind: 'shared-warehouse_summary' as const,
        title: `[${r.summary_type}] ${r.title}`,
        content: scrubbed.text,
        contentHash: sha256(scrubbed.text),
        metadata: {
          summary_type: r.summary_type,
          fact_count: r.fact_count,
          source: 'knowledge_summaries',
        },
        occurredAt: new Date(r.created_at),
      };
    });
  } catch (err) {
    logger.logMinimal('knowledge_summaries read failed:', (err as Error).message);
    return [];
  }
}

/** Read calendar events from warehouse_raw_calendar_events (past + future window). */
export async function readCalendarEvents(pastDays: number, futureDays: number): Promise<WarehouseItem[]> {
  const pool = getWarehouseReaderPool();
  // warehouse_raw_calendar_events is the accessible table (broadside_reader has SELECT).
  // device_calendar_events does not exist in the shared warehouse — this is the correct source.
  const TABLE = 'warehouse_raw_calendar_events';
  try {
    const { rows: cols } = await pool.query<{ column_name: string }>(
      `SELECT a.attname AS column_name
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1
          AND a.attnum > 0 AND NOT a.attisdropped`,
      [TABLE],
    );
    const colSet = new Set(cols.map((c) => c.column_name));
    if (!colSet.has('device_id') && !colSet.has('id')) {
      logger.logVerbose(`${TABLE} missing expected columns — skipping`);
      return [];
    }

    const idCol = colSet.has('device_id') ? 'device_id' : 'id';
    const hasLocation = colSet.has('location');
    const hasNotes = colSet.has('notes');
    const hasCalendarName = colSet.has('calendar_name');

    const selectCols = [
      `${idCol} AS eid`,
      'title',
      'start_date',
      'end_date',
      'is_all_day',
      hasLocation ? 'location' : "NULL AS location",
      hasNotes ? 'notes' : "NULL AS notes",
      hasCalendarName ? 'calendar_name' : "NULL AS calendar_name",
    ].join(', ');

    const { rows } = await pool.query<{
      eid: string;
      title: string;
      start_date: string;
      end_date: string;
      is_all_day: boolean;
      location: string | null;
      notes: string | null;
      calendar_name: string | null;
    }>(
      `SELECT ${selectCols}
         FROM ${TABLE}
        WHERE start_date >= now() - ($1 || ' days')::interval
          AND start_date <= now() + ($2 || ' days')::interval
          AND title IS NOT NULL AND title <> ''
        ORDER BY start_date ASC
        LIMIT 200`,
      [pastDays, futureDays],
    );
    logger.log(`${TABLE}: ${rows.length} events (${pastDays}d back, ${futureDays}d ahead)`);

    return rows.map((r) => {
      const parts = [r.title];
      if (r.location) parts.push(`Location: ${r.location}`);
      if (r.is_all_day) parts.push('All day');
      else parts.push(`${new Date(r.start_date).toISOString()} — ${new Date(r.end_date).toISOString()}`);
      if (r.calendar_name) parts.push(`Calendar: ${r.calendar_name}`);
      if (r.notes) parts.push(r.notes.slice(0, 500));
      const content = parts.join('\n');
      const scrubbed = scrubSecrets(content);

      return {
        externalId: String(r.eid),
        kind: 'calendar_event' as const,
        title: r.title,
        content: scrubbed.text,
        contentHash: sha256(scrubbed.text),
        metadata: {
          location: r.location,
          is_all_day: r.is_all_day,
          calendar_name: r.calendar_name,
          source: 'device_calendar_events',
        },
        occurredAt: new Date(r.start_date),
      };
    });
  } catch (err) {
    logger.logMinimal('device_calendar_events read failed:', (err as Error).message);
    return [];
  }
}
