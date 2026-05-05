import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';
import { csvToObjects } from '@/lib/csv';
import { currentBrand } from '@/lib/brand';

const logger = createLogger('api/linkedin/import-csv');

export const dynamic = 'force-dynamic';

/**
 * Import historical LinkedIn posts from a user-supplied Shares.csv
 * (from Settings → Download your data → Posts).
 *
 * The CSV contains columns like ShareCommentary, ShareLink, Date, Visibility.
 * Column names vary slightly across exports — we look them up case-insensitively
 * and tolerate missing fields.
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'file required (multipart form field "file")' }, { status: 400 });
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'file too large (max 50MB)' }, { status: 413 });
    }

    const text = await file.text();
    const rows = csvToObjects(text);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'CSV empty or missing header' }, { status: 400 });
    }

    // Find relevant columns case-insensitively
    const sampleKeys = Object.keys(rows[0]);
    const bodyKey = findKey(sampleKeys, ['ShareCommentary', 'commentary', 'text']);
    const linkKey = findKey(sampleKeys, ['ShareLink', 'link', 'url']);
    const dateKey = findKey(sampleKeys, ['Date', 'ShareDate', 'created']);
    const visibilityKey = findKey(sampleKeys, ['Visibility', 'visibility']);

    if (!bodyKey) {
      return NextResponse.json({
        error: `CSV missing commentary column. Expected one of: ShareCommentary. Found: ${sampleKeys.join(', ')}`,
      }, { status: 400 });
    }

    logger.log(`parsing ${rows.length} rows; using columns body=${bodyKey} link=${linkKey} date=${dateKey}`);

    const pool = getPool();
    const brand = await currentBrand();
    let imported = 0;
    let skippedEmpty = 0;
    let skippedDuplicate = 0;
    let failed = 0;

    for (const row of rows) {
      const body = (row[bodyKey] ?? '').trim();
      const url = linkKey ? (row[linkKey] ?? '').trim() : '';
      const dateStr = dateKey ? (row[dateKey] ?? '').trim() : '';
      const visibility = visibilityKey ? (row[visibilityKey] ?? '').trim() : '';

      // Skip empty, private, or pure reshares (no commentary)
      if (!body || body.length < 10) {
        skippedEmpty++;
        continue;
      }

      // Parse the date. LinkedIn uses formats like "2024-03-14 10:25:12 UTC" or "2024-03-14"
      const postedAt = parseLinkedInDate(dateStr);

      // Dedup on URL if we have one
      if (url) {
        const { rows: existing } = await pool.query(
          `SELECT id FROM posts WHERE posted_url = $1 LIMIT 1`,
          [url],
        );
        if (existing.length > 0) {
          skippedDuplicate++;
          continue;
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { rows: cgRows } = await client.query<{ id: string }>(
          `INSERT INTO content_groups (brand_id, status, source, notes)
           VALUES ($1, 'posted', 'imported', $2)
           RETURNING id`,
          [brand.id, `Imported from LinkedIn CSV${visibility ? ` (${visibility})` : ''}`],
        );
        const cgId = cgRows[0].id;

        await client.query(
          `INSERT INTO posts (content_group_id, platform_id, body, status, posted_at, posted_url)
           VALUES ($1, 'linkedin', $2, 'posted', $3, $4)`,
          [cgId, body, postedAt, url || null],
        );

        // Also feed the voice pipeline
        await client.query(
          `INSERT INTO voice_samples (platform_id, body, is_published, source, notes)
           VALUES ('linkedin', $1, true, 'linkedin-csv-import', $2)`,
          [body, url ? `Imported from LinkedIn CSV (${url})` : 'Imported from LinkedIn CSV'],
        );

        await client.query('COMMIT');
        imported++;
      } catch (err) {
        await client.query('ROLLBACK');
        failed++;
        logger.logMinimal('row import failed:', (err as Error).message);
      } finally {
        client.release();
      }
    }

    logger.log(`csv import: imported=${imported} skippedEmpty=${skippedEmpty} skippedDup=${skippedDuplicate} failed=${failed}`);

    return NextResponse.json({
      imported,
      skipped_empty: skippedEmpty,
      skipped_duplicate: skippedDuplicate,
      failed,
      total_rows: rows.length,
    });
  } catch (err) {
    logger.logMinimal('csv import failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function findKey(keys: string[], candidates: string[]): string | null {
  const lower = new Map(keys.map(k => [k.toLowerCase(), k]));
  for (const c of candidates) {
    const hit = lower.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function parseLinkedInDate(s: string): Date | null {
  if (!s) return null;
  // LinkedIn: "2024-03-14 10:25:12 UTC" or "2024-03-14"
  const normalized = s.replace(' UTC', 'Z').replace(' ', 'T');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}
