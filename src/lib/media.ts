import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('media');

const MEDIA_ROOT = process.env.BROADSIDE_MEDIA_ROOT ?? '/data/broadside/media';

export interface MediaRecord {
  id: string;
  content_group_id: string | null;
  kind: 'image' | 'link_preview';
  path: string;
  filename: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  created_at: string;
}

export async function listMedia(groupId: string): Promise<MediaRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query<MediaRecord>(
    `SELECT * FROM media WHERE content_group_id = $1 ORDER BY created_at DESC`,
    [groupId],
  );
  return rows;
}

export async function getMedia(id: string): Promise<MediaRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query<MediaRecord>(
    `SELECT * FROM media WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export function getMediaFilePath(record: MediaRecord): string {
  return join(MEDIA_ROOT, record.path);
}

export async function uploadMedia(input: {
  groupId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  altText?: string;
}): Promise<MediaRecord> {
  const { groupId, filename, mimeType, data, altText } = input;

  // Validate mime type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm'];
  if (!allowedTypes.includes(mimeType)) {
    throw new Error(`unsupported file type: ${mimeType}`);
  }

  // Max 20MB
  if (data.length > 20 * 1024 * 1024) {
    throw new Error('file too large (max 20MB)');
  }

  const id = randomUUID();
  const ext = extname(filename) || mimeTypeToExt(mimeType);
  const relativePath = `${groupId}/${id}${ext}`;
  const absolutePath = join(MEDIA_ROOT, relativePath);

  // Ensure directory exists
  await mkdir(join(MEDIA_ROOT, groupId), { recursive: true });

  // Write file
  await writeFile(absolutePath, data);
  logger.log(`wrote ${data.length} bytes to ${relativePath}`);

  // Insert record
  const pool = getPool();
  const { rows } = await pool.query<MediaRecord>(
    `INSERT INTO media (id, content_group_id, kind, path, filename, mime_type, alt_text)
     VALUES ($1, $2, 'image', $3, $4, $5, $6)
     RETURNING *`,
    [id, groupId, relativePath, filename, mimeType, altText ?? null],
  );

  logger.log(`created media record ${id} for group ${groupId}`);
  return rows[0];
}

export async function deleteMedia(id: string): Promise<void> {
  const pool = getPool();
  const record = await getMedia(id);
  if (!record) throw new Error(`media ${id} not found`);

  // Delete file
  try {
    await unlink(join(MEDIA_ROOT, record.path));
    logger.log(`deleted file ${record.path}`);
  } catch (err) {
    logger.logMinimal(`failed to delete file ${record.path}:`, (err as Error).message);
  }

  // Delete record
  await pool.query(`DELETE FROM media WHERE id = $1`, [id]);
  logger.log(`deleted media record ${id}`);
}

export async function updateMediaAltText(id: string, altText: string | null): Promise<MediaRecord> {
  const pool = getPool();
  const { rows } = await pool.query<MediaRecord>(
    `UPDATE media SET alt_text = $1 WHERE id = $2 RETURNING *`,
    [altText, id],
  );
  if (rows.length === 0) throw new Error(`media ${id} not found`);
  return rows[0];
}

function mimeTypeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  };
  return map[mime] ?? '.bin';
}
