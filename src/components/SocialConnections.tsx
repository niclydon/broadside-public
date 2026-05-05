import { getAllBrands } from '@/lib/brand';
import { query } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SocialConnections');

interface TwitterStatus {
  connected: boolean;
  username: string | null;
}

interface BlueskyStatus {
  connected: boolean;
  handle: string | null;
}

interface BrandConnection {
  slug: string;
  name: string;
  twitter: TwitterStatus;
  bluesky: BlueskyStatus;
}

async function getTwitterStatus(brandSlug: string): Promise<TwitterStatus> {
  const scopedKey = `twitter.oauth_tokens.${brandSlug}`;
  // For the default showcase brand, also check the legacy unscoped key
  const keys = brandSlug === 'studio'
    ? [scopedKey, 'twitter.oauth_tokens']
    : [scopedKey];
  try {
    const { rows } = await query<{ value: unknown }>(
      `SELECT value FROM settings WHERE key = ANY($1::text[]) ORDER BY key DESC LIMIT 1`,
      [keys],
    );
    if (rows.length === 0) return { connected: false, username: null };
    const data = rows[0].value as { username?: string; expires_at?: string };
    const expired = data.expires_at ? new Date(data.expires_at).getTime() < Date.now() : false;
    return { connected: !expired, username: data.username ?? null };
  } catch (err) {
    logger.log('getTwitterStatus failed for', brandSlug, (err as Error).message);
    return { connected: false, username: null };
  }
}

function getBlueskyStatus(brandSlug: string): BlueskyStatus {
  if (brandSlug === 'broadcast') {
    const handle = process.env.BLUESKY_IDENTIFIER_SIGNAL_CAST ?? null;
    return { connected: !!handle, handle };
  }
  if (brandSlug === 'lab') {
    const handle = process.env.BLUESKY_IDENTIFIER ?? null;
    return { connected: !!handle, handle };
  }
  // All other brands have no Bluesky account wired
  return { connected: false, handle: null };
}

export async function SocialConnections({ justConnected }: { justConnected?: string }) {
  const brands = await getAllBrands();
  const connections: BrandConnection[] = await Promise.all(
    brands.map(async (b) => ({
      slug: b.slug,
      name: b.name,
      twitter: await getTwitterStatus(b.slug),
      bluesky: getBlueskyStatus(b.slug),
    })),
  );

  return (
    <div className="bs-card p-4 mt-6">
      <div className="bs-label mb-3">Social Connections</div>
      {justConnected && (
        <p className="text-xs text-[var(--accent)] mb-3">
          Connected X/Twitter for {justConnected}.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[var(--muted)] text-left text-xs">
            <th className="pb-2 font-normal w-1/3">Brand</th>
            <th className="pb-2 font-normal w-1/3">Twitter / X</th>
            <th className="pb-2 font-normal w-1/3">Bluesky</th>
          </tr>
        </thead>
        <tbody>
          {connections.map((conn) => (
            <tr key={conn.slug} className="border-t border-[var(--border)]">
              <td className="py-3 text-[var(--text)]">{conn.name}</td>
              <td className="py-3">
                {conn.twitter.connected ? (
                  <span className="text-[var(--accent)] text-xs">connected · @{conn.twitter.username}</span>
                ) : (
                  <span className="text-[var(--text-dim)] text-xs">not connected</span>
                )}
                <a
                  href={`/api/auth/twitter?brand=${conn.slug}`}
                  className="ml-2 text-xs text-[var(--accent)] hover:underline"
                >
                  {conn.twitter.connected ? 'Reconnect' : 'Connect'}
                </a>
              </td>
              <td className="py-3">
                {conn.bluesky.connected ? (
                  <span className="text-[var(--accent)] text-xs">connected · @{conn.bluesky.handle}</span>
                ) : (
                  <span className="text-[var(--text-dim)] text-xs">not connected</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
