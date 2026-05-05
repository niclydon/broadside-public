/**
 * S3-compatible object storage client wrapper for the brand-asset library.
 *
 * Objects are keyed `brand-assets/YYYY/MM/<uuid>.<ext>`. The storage bucket
 * stays private; files are served back through Broadside's
 * `/api/brand-assets/{id}/file` proxy.
 */
import { Client as MinioClient } from 'minio';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@/lib/logger';

const logger = createLogger('minio');

const ENDPOINT = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? '';
const SECRET_KEY = process.env.MINIO_SECRET_KEY ?? '';
const BUCKET_BRAND_ASSETS = process.env.MINIO_BUCKET_BRAND_ASSETS ?? 'broadside-brand-assets';

let client: MinioClient | null = null;

function getClient(): MinioClient {
  if (client) return client;
  if (!ACCESS_KEY || !SECRET_KEY) {
    throw new Error('MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set');
  }
  const url = new URL(ENDPOINT);
  client = new MinioClient({
    endPoint: url.hostname,
    port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10),
    useSSL: url.protocol === 'https:',
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
  });
  logger.log(`object storage client init: ${url.hostname}:${url.port} bucket=${BUCKET_BRAND_ASSETS}`);
  return client;
}

export const BRAND_ASSETS_BUCKET = BUCKET_BRAND_ASSETS;

/** Build a date-partitioned key with a UUID stem and the original extension. */
export function buildBrandAssetKey(filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()! : 'bin';
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uuid = randomUUID();
  return `brand-assets/${yyyy}/${mm}/${uuid}.${ext}`;
}

/** Upload a buffer to the brand-assets bucket. Returns the key. */
export async function putBrandAsset(
  key: string,
  data: Buffer,
  mimeType: string,
): Promise<void> {
  const c = getClient();
  await c.putObject(BUCKET_BRAND_ASSETS, key, data, data.length, {
    'Content-Type': mimeType,
  });
  logger.logVerbose(`putObject ${key} (${data.length} bytes, ${mimeType})`);
}

/** Stream an object back as a Buffer. Used by the file-serving proxy route. */
export async function getBrandAsset(key: string): Promise<{ data: Buffer; mimeType: string }> {
  const c = getClient();
  const stream = await c.getObject(BUCKET_BRAND_ASSETS, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const stat = await c.statObject(BUCKET_BRAND_ASSETS, key);
  return { data: Buffer.concat(chunks), mimeType: stat.metaData?.['content-type'] ?? 'application/octet-stream' };
}

/** Hard-delete an object. (Soft delete lives on the DB row, not the object.) */
export async function deleteBrandAsset(key: string): Promise<void> {
  const c = getClient();
  await c.removeObject(BUCKET_BRAND_ASSETS, key);
  logger.logVerbose(`removeObject ${key}`);
}

/** Quick smoke test for /api/health to call. */
export async function pingMinio(): Promise<{ ok: boolean; detail: string }> {
  try {
    const c = getClient();
    const exists = await c.bucketExists(BUCKET_BRAND_ASSETS);
    return { ok: exists, detail: exists ? 'bucket present' : `bucket ${BUCKET_BRAND_ASSETS} missing` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
