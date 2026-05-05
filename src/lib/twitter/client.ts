// X/Twitter publishing client via OAuth 2.0 with PKCE.
// The free tier allows posting (1,500/month, 50/day). No read access.

import crypto from 'node:crypto';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('twitter');

const TWITTER_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TWITTER_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const TWITTER_API = 'https://api.twitter.com/2';

function getClientId(): string {
  const id = process.env.TWITTER_CLIENT_ID;
  if (!id) throw new Error('TWITTER_CLIENT_ID not set');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.TWITTER_CLIENT_SECRET;
  if (!secret) throw new Error('TWITTER_CLIENT_SECRET not set');
  return secret;
}

function getRedirectUri(): string {
  return process.env.TWITTER_REDIRECT_URI ?? 'https://broadside.example/api/auth/twitter/callback';
}

// PKCE helpers
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

const pendingVerifiers = new Map<string, string>(); // brand slug → PKCE verifier

const LEGACY_SETTINGS_KEY = 'twitter.oauth_tokens';
function settingsKey(brandSlug: string): string {
  return `twitter.oauth_tokens.${brandSlug}`;
}

/** Build the X OAuth 2.0 authorization URL with PKCE. */
export function getAuthorizationUrl(state: string, brandSlug: string): string {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  pendingVerifiers.set(brandSlug, codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${TWITTER_AUTH_URL}?${params}`;
}

/** Exchange authorization code for tokens. */
export async function exchangeCodeForTokens(code: string, brandSlug: string): Promise<{
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
}> {
  const verifier = pendingVerifiers.get(brandSlug);
  if (!verifier) throw new Error('no PKCE verifier — restart the auth flow');
  pendingVerifiers.delete(brandSlug);

  const stop = logger.time('exchangeCode');
  const basicAuth = Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64');

  const res = await fetch(TWITTER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: verifier,
    }),
  });
  stop();

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X token exchange failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  };
  logger.log('X token exchanged, expires_in:', data.expires_in);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in,
  };
}

/** Refresh an expired access token. */
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
}> {
  const basicAuth = Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64');

  const res = await fetch(TWITTER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X token refresh failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in,
  };
}

/** Get the authenticated user's info. */
export async function getMe(accessToken: string): Promise<{ id: string; username: string; name: string }> {
  const res = await fetch(`${TWITTER_API}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X /users/me failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { data: { id: string; username: string; name: string } };
  return data.data;
}

export async function storeTokens(data: {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  user_id: string;
  username: string;
  name: string;
}, brandSlug: string): Promise<void> {
  const pool = getPool();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  const value = JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    user_id: data.user_id,
    username: data.username,
    name: data.name,
  });
  const key = settingsKey(brandSlug);
  await pool.query(
    `INSERT INTO settings (key, value, description, updated_by)
     VALUES ($1, $2::jsonb, 'X/Twitter OAuth 2.0 tokens', 'system')
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [key, value],
  );
  logger.log(`X tokens stored for @${data.username} (brand: ${brandSlug})`);
}

/** Get a valid access token, refreshing if needed. */
export async function getValidAccessToken(brandSlug: string): Promise<{ token: string; userId: string; username: string } | null> {
  const pool = getPool();

  // Only the default showcase brand gets the legacy unscoped key fallback — other brands must have
  // their own scoped token to prevent cross-brand token contamination.
  const keys = brandSlug === 'studio'
    ? [settingsKey(brandSlug), LEGACY_SETTINGS_KEY]
    : [settingsKey(brandSlug)];
  const { rows } = await pool.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = ANY($1::text[]) ORDER BY key DESC LIMIT 1`,
    [keys],
  );
  if (rows.length === 0) return null;

  const data = rows[0].value as {
    access_token: string;
    refresh_token: string | null;
    expires_at: string;
    user_id: string;
    username: string;
  };

  const expiresAt = new Date(data.expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return { token: data.access_token, userId: data.user_id, username: data.username };
  }

  if (!data.refresh_token) {
    logger.logMinimal('X token expired, no refresh token');
    return null;
  }

  try {
    const refreshed = await refreshAccessToken(data.refresh_token);
    const newExpires = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    const updated = JSON.stringify({
      ...data,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? data.refresh_token,
      expires_at: newExpires,
    });
    // Always write to the scoped key on refresh (migrates legacy key implicitly)
    await pool.query(
      `INSERT INTO settings (key, value, description, updated_by)
       VALUES ($1, $2::jsonb, 'X/Twitter OAuth 2.0 tokens', 'system')
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [settingsKey(brandSlug), updated],
    );
    return { token: refreshed.access_token, userId: data.user_id, username: data.username };
  } catch (err) {
    logger.logMinimal('X token refresh failed:', (err as Error).message);
    return null;
  }
}

/** Post a tweet, optionally as a reply to continue a thread. */
export async function postTweet(text: string, replyToTweetId?: string, brandSlug = 'studio'): Promise<{ id: string; tweetUrl: string }> {
  const auth = await getValidAccessToken(brandSlug);
  if (!auth) throw new Error(`X not connected for brand "${brandSlug}". Visit /settings to connect.`);

  // X free tier: 280 chars
  const truncated = [...text].length > 280 ? [...text].slice(0, 277).join('') + '…' : text;

  const body: Record<string, unknown> = { text: truncated };
  if (replyToTweetId) {
    body.reply = { in_reply_to_tweet_id: replyToTweetId };
  }

  const stop = logger.time('postTweet');
  const res = await fetch(`${TWITTER_API}/tweets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  stop();

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`X post failed: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as { data: { id: string; text: string } };
  const tweetUrl = `https://x.com/${auth.username}/status/${data.data.id}`;
  logger.log(replyToTweetId ? 'posted reply to X:' : 'posted to X:', tweetUrl);
  return { id: data.data.id, tweetUrl };
}

/**
 * Post a multi-part thread to X. Each part is chained as a reply to the previous.
 * Returns the URL of the first (root) tweet. A brief delay between parts avoids
 * rate limiting.
 */
export async function postTwitterThread(parts: string[], brandSlug = 'studio'): Promise<{
  rootId: string;
  rootUrl: string;
  tweetIds: string[];
}> {
  if (parts.length === 0) throw new Error('thread must have at least one part');
  const stop = logger.time('postTwitterThread');

  const first = await postTweet(parts[0], undefined, brandSlug);
  const tweetIds: string[] = [first.id];
  let replyTarget = first.id;

  for (let i = 1; i < parts.length; i++) {
    await new Promise(r => setTimeout(r, 500));
    const next = await postTweet(parts[i], replyTarget, brandSlug);
    tweetIds.push(next.id);
    replyTarget = next.id;
  }

  stop();
  logger.log(`posted ${parts.length}-part thread to X, root: ${first.tweetUrl}`);
  return { rootId: first.id, rootUrl: first.tweetUrl, tweetIds };
}
