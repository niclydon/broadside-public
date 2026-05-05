/**
 * Brand-asset library — server-side helpers.
 *
 * Distinct from src/lib/media.ts (which is per-content-group ephemeral
 * attachments). This module owns the curated, reusable brand library backed
 * by object storage.
 */
import { query } from '@/lib/db/pool';
import {
  buildBrandAssetKey,
  putBrandAsset,
  getBrandAsset as getMinioObject,
  deleteBrandAsset as deleteMinioObject,
} from '@/lib/minio/client';
import imageSize from 'image-size';
import { createLogger } from '@/lib/logger';

const logger = createLogger('brand-assets');

export const RECOMMENDED_USE_CASES = [
  'avatar',
  'banner',
  'hero',
  'og-card',
  'icon',
  'background',
  'illustration',
  'template',
  'monogram',
  'other',
] as const;
export type UseCase = (typeof RECOMMENDED_USE_CASES)[number] | string;

export const RECOMMENDED_PLATFORMS = [
  'linkedin',
  'twitter',
  'bluesky',
  'github',
  'substack',
  'web',
  'youtube',
  'facebook',
  'instagram',
  'macos',
  'ios',
] as const;
export type Platform = (typeof RECOMMENDED_PLATFORMS)[number] | string;

/**
 * Filename convention — see docs/BRAND_ASSET_NAMING.md for the spec.
 *
 * Pattern: <use_case>__<brand>__<platform>__<slug>[__<variant>].<ext>
 * Reserved tokens: "neutral" for brand-agnostic, "multi" for multi-platform.
 */
export const FILENAME_CONVENTION_REGEX =
  /^[a-z][a-z0-9-]*__[a-z0-9-]+__[a-z0-9-]+__[a-z][a-z0-9-]*(__[a-z0-9-]+)?\.[a-z0-9]{2,5}$/;
export const FILENAME_MAX_LENGTH = 120;

export function isValidBrandAssetFilename(name: string): boolean {
  if (name.length > FILENAME_MAX_LENGTH) return false;
  return FILENAME_CONVENTION_REGEX.test(name);
}

/** Lowercase, ASCII-only, dash-separated. Strips/replaces invalid chars. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '') // drop non-ASCII (e.g. ō → "")
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Compose a canonical filename per the convention. */
export function buildCanonicalFilename(input: {
  use_case: string;
  brand_slug: string | null;  // null → "neutral"
  platform: string | null;     // null → "multi"
  slug: string;
  variant?: string | null;
  ext: string;                 // without leading dot
}): string {
  const ext = input.ext.toLowerCase().replace(/^\./, '');
  const brand = input.brand_slug ?? 'neutral';
  const platform = input.platform ?? 'multi';
  const slug = slugify(input.slug);
  const parts = [input.use_case, brand, platform, slug].map((p) => slugify(p));
  const variantPart = input.variant ? `__${slugify(input.variant)}` : '';
  return `${parts.join('__')}${variantPart}.${ext}`;
}

export interface BrandAssetRow {
  id: string;
  brand_id: string | null;
  filename: string;
  storage_path: string;
  url: string | null;
  use_case: string;
  platform: string | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  size_bytes: number | null;
  alt_text: string | null;
  is_current: boolean;
  notes: string | null;
  source_label: string | null;
  vlm_description: string | null;
  vlm_description_generated_at: string | null;
  actor: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ListFilters {
  use_case?: string;
  platform?: string | null;        // pass null to filter to platform-neutral assets
  brand_id?: string | null;
  is_current?: boolean;
  source_label?: string;
  include_deleted?: boolean;
}

export async function listBrandAssets(filters: ListFilters = {}): Promise<BrandAssetRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!filters.include_deleted) conditions.push('deleted_at IS NULL');

  if (filters.use_case) {
    params.push(filters.use_case);
    conditions.push(`use_case = $${params.length}`);
  }
  if (filters.platform === null) {
    conditions.push('platform IS NULL');
  } else if (filters.platform) {
    params.push(filters.platform);
    conditions.push(`platform = $${params.length}`);
  }
  if (filters.brand_id === null) {
    conditions.push('brand_id IS NULL');
  } else if (filters.brand_id) {
    params.push(filters.brand_id);
    conditions.push(`brand_id = $${params.length}`);
  }
  if (typeof filters.is_current === 'boolean') {
    params.push(filters.is_current);
    conditions.push(`is_current = $${params.length}`);
  }
  if (filters.source_label) {
    params.push(filters.source_label);
    conditions.push(`source_label = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query<BrandAssetRow>(
    `SELECT * FROM media_assets ${where}
     ORDER BY use_case, platform NULLS FIRST, is_current DESC, created_at DESC`,
    params,
  );
  return rows;
}

export async function getBrandAsset(id: string): Promise<BrandAssetRow | null> {
  const { rows } = await query<BrandAssetRow>(
    `SELECT * FROM media_assets WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface CreateAssetInput {
  filename: string;
  data: Buffer;
  mimeType: string;
  use_case: string;
  platform?: string | null;
  brand_id?: string | null;
  alt_text?: string | null;
  notes?: string | null;
  is_current?: boolean;
  source_label?: string | null;
  url?: string | null;
  actor?: string;
  /** Skip the synchronous VLM-description call. Used during bulk imports. */
  skip_vlm?: boolean;
}

export async function createBrandAsset(input: CreateAssetInput): Promise<BrandAssetRow> {
  if (!isValidBrandAssetFilename(input.filename)) {
    throw new Error(
      `filename does not match the brand-asset naming convention: ${input.filename}. ` +
      `See docs/BRAND_ASSET_NAMING.md or use buildCanonicalFilename() to compose a valid name.`,
    );
  }
  const key = buildBrandAssetKey(input.filename);
  let width: number | null = null;
  let height: number | null = null;
  try {
    const dims = imageSize(input.data);
    width = dims.width ?? null;
    height = dims.height ?? null;
  } catch {
    // Non-image file or unparseable — leave dimensions null.
  }

  await putBrandAsset(key, input.data, input.mimeType);

  const inserted = await query<BrandAssetRow>(
    `INSERT INTO media_assets
       (filename, storage_path, mime_type, size_bytes, width, height,
        use_case, platform, brand_id, alt_text, notes, is_current,
        source_label, url, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      input.filename,
      key,
      input.mimeType,
      input.data.length,
      width,
      height,
      input.use_case,
      input.platform ?? null,
      input.brand_id ?? null,
      input.alt_text ?? null,
      input.notes ?? null,
      input.is_current ?? false,
      input.source_label ?? null,
      input.url ?? null,
      input.actor ?? 'human:operator',
    ],
  );

  if (input.is_current) {
    await clearOtherCurrent(inserted.rows[0]);
  }

  logger.log(`createBrandAsset id=${inserted.rows[0].id.slice(0, 8)} use_case=${input.use_case} platform=${input.platform ?? 'null'}`);

  // Best-effort sync VLM description. Don't fail the upload if VLM is down /
  // slow; backfill catches any NULLs.
  if (!input.skip_vlm && isImageMime(input.mimeType)) {
    try {
      const description = await describeImage(input.data, input.mimeType);
      const updated = await query<BrandAssetRow>(
        `UPDATE media_assets
            SET vlm_description = $1, vlm_description_generated_at = now()
          WHERE id = $2
          RETURNING *`,
        [description, inserted.rows[0].id],
      );
      return updated.rows[0] ?? inserted.rows[0];
    } catch (err) {
      logger.logVerbose(`VLM describe failed for ${inserted.rows[0].id.slice(0, 8)}: ${(err as Error).message}`);
    }
  }

  return inserted.rows[0];
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/') && !mime.includes('svg');
}

const VLM_TIMEOUT_MS = 25_000;

/**
 * Generate a one-sentence description via a local model gateway's /v1/describe endpoint.
 * Throws on failure — caller decides what to do.
 */
export async function describeImage(data: Buffer, mimeType: string): Promise<string> {
  const gatewayBase = process.env.LOCAL_MODEL_GATEWAY_BASE_URL ?? 'http://localhost:8080/v1';
  const gatewayKey = process.env.LOCAL_MODEL_GATEWAY_API_KEY;
  if (!gatewayKey) throw new Error('LOCAL_MODEL_GATEWAY_API_KEY not set');

  const fmt = (mimeType.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
  const body = JSON.stringify({
    image: data.toString('base64'),
    image_format: fmt,
    prompt:
      'Describe this image in one short sentence (under 25 words). Focus on the visual subject, style, and mood. Do not editorialize or speculate about purpose.',
    max_tokens: 80,
    temperature: 0.2,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${gatewayBase}/describe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayKey}`,
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`local model gateway /v1/describe HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { description?: string };
    if (!json.description) throw new Error('local model gateway response missing "description"');
    return json.description.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Re-run VLM on an asset and update the row. Used by the regenerate endpoint. */
export async function regenerateVlmDescription(id: string): Promise<BrandAssetRow | null> {
  const asset = await getBrandAsset(id);
  if (!asset || asset.deleted_at) return null;
  if (!isImageMime(asset.mime_type ?? '')) {
    throw new Error('Cannot describe non-image asset');
  }
  const { data } = await getMinioObject(asset.storage_path);
  const description = await describeImage(data, asset.mime_type ?? 'image/png');
  const { rows } = await query<BrandAssetRow>(
    `UPDATE media_assets
        SET vlm_description = $1, vlm_description_generated_at = now()
      WHERE id = $2
      RETURNING *`,
    [description, id],
  );
  return rows[0] ?? null;
}

export interface UpdateAssetInput {
  alt_text?: string | null;
  notes?: string | null;
  platform?: string | null;
  use_case?: string;
  brand_id?: string | null;
  is_current?: boolean;
  filename?: string;
  url?: string | null;
}

export async function updateBrandAsset(id: string, input: UpdateAssetInput): Promise<BrandAssetRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  const fields = ['alt_text', 'notes', 'platform', 'use_case', 'brand_id', 'is_current', 'filename', 'url'] as const;
  for (const f of fields) {
    if (input[f] !== undefined) {
      params.push(input[f]);
      sets.push(`${f} = $${params.length}`);
    }
  }

  if (sets.length === 0) return getBrandAsset(id);

  params.push(id);
  const { rows } = await query<BrandAssetRow>(
    `UPDATE media_assets SET ${sets.join(', ')}
       WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING *`,
    params,
  );

  if (rows.length === 0) return null;

  if (input.is_current === true) {
    await clearOtherCurrent(rows[0]);
  }

  return rows[0];
}

/** Soft-delete: sets deleted_at and unsets is_current. Object stays in backing storage. */
export async function softDeleteBrandAsset(id: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE media_assets
        SET deleted_at = now(), is_current = false
      WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/** Hard-delete: removes both DB row and stored object. Use cautiously. */
export async function hardDeleteBrandAsset(id: string): Promise<boolean> {
  const asset = await getBrandAsset(id);
  if (!asset) return false;
  try {
    await deleteMinioObject(asset.storage_path);
  } catch (err) {
    logger.logMinimal(`object storage delete failed for ${asset.storage_path}: ${(err as Error).message}`);
  }
  const { rowCount } = await query(`DELETE FROM media_assets WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Atomically clear is_current on other rows in the same slot. The slot key
 * is (use_case, platform, brand_id) — so e.g. studio's "hero" doesn't
 * compete with lab's "hero" even though both share use_case+platform.
 * Brand-neutral assets (brand_id NULL) form their own slot.
 */
async function clearOtherCurrent(row: BrandAssetRow): Promise<void> {
  await query(
    `UPDATE media_assets
        SET is_current = false
      WHERE id <> $1
        AND use_case = $2
        AND platform IS NOT DISTINCT FROM $3
        AND brand_id IS NOT DISTINCT FROM $4
        AND is_current = true
        AND deleted_at IS NULL`,
    [row.id, row.use_case, row.platform, row.brand_id],
  );
}

/** Fetch object bytes for the proxy route. */
export async function streamBrandAsset(id: string): Promise<{ data: Buffer; mimeType: string; filename: string } | null> {
  const asset = await getBrandAsset(id);
  if (!asset || asset.deleted_at) return null;
  const { data, mimeType } = await getMinioObject(asset.storage_path);
  return { data, mimeType: asset.mime_type ?? mimeType, filename: asset.filename };
}
