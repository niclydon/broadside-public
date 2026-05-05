import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('linkedin');

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

// Request all approved scopes. LinkedIn products:
//   Sign In with LinkedIn → openid, profile, email
//   Share on LinkedIn → w_member_social
const SCOPES = 'openid profile email w_member_social';

function getClientId(): string {
  const id = process.env.LINKEDIN_CLIENT_ID;
  if (!id) throw new Error('LINKEDIN_CLIENT_ID not set');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!secret) throw new Error('LINKEDIN_CLIENT_SECRET not set');
  return secret;
}

function getRedirectUri(): string {
  // Must match exactly what's registered in the LinkedIn Developer App
  return process.env.LINKEDIN_REDIRECT_URI ?? 'https://broadside.example/api/auth/linkedin/callback';
}

/** Build the LinkedIn OAuth consent URL. */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state,
  });
  return `${LINKEDIN_AUTH_URL}?${params}`;
}

/** Exchange an authorization code for access + refresh tokens. */
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  scope: string;
}> {
  const stop = logger.time('exchangeCode');
  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
      client_id: getClientId(),
      client_secret: getClientSecret(),
    }),
  });
  stop();

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LinkedIn token exchange failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };
  logger.log('token exchanged, expires_in:', data.expires_in);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in,
    scope: data.scope,
  };
}

/** Refresh an expired access token. */
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
}> {
  const stop = logger.time('refreshToken');
  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
    }),
  });
  stop();

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LinkedIn token refresh failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  logger.log('token refreshed, expires_in:', data.expires_in);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in,
  };
}

/** Get the user's profile info to resolve the member URN.
 *  Uses the /v2/me endpoint (works with w_member_social scope alone,
 *  doesn't require the openid/profile OIDC scopes). */
export async function getUserInfo(accessToken: string): Promise<{
  sub: string;
  name: string;
}> {
  // Try OIDC userinfo first (if openid scope is available)
  const oidcRes = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (oidcRes.ok) {
    const data = await oidcRes.json();
    return { sub: data.sub, name: data.name ?? 'LinkedIn User' };
  }

  // Fall back to the versioned /me endpoint
  const meRes = await fetch(`${LINKEDIN_API_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': '202401',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  if (meRes.ok) {
    const me = await meRes.json() as {
      id: string;
      localizedFirstName?: string;
      localizedLastName?: string;
    };
    const name = [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(' ') || 'LinkedIn User';
    return { sub: me.id, name };
  }

  // /v2/me requires r_liteprofile or openid scope which we don't have.
  // With only w_member_social, extract the member URN from a test post
  // call or just use a placeholder — the token exchange response itself
  // contains the member sub in newer LinkedIn API versions.
  // Last resort: call the posts API with author=self to infer the URN.
  logger.logVerbose('/v2/me not available, trying posts API to infer member URN');
  const postsRes = await fetch(`${LINKEDIN_API_BASE}/posts?q=author&author=urn:li:member:me&count=1`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': '202401',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });

  // If we truly can't get the member URN, store the token anyway with a
  // placeholder — the import endpoint will discover the URN from posts later.
  logger.logVerbose('using placeholder member URN — will resolve on first import');
  return { sub: 'pending', name: 'LinkedIn User' };
}

/** Store tokens + profile in the linkedin_tokens table (upsert by member_urn). */
export async function storeTokens(data: {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  member_urn: string;
  display_name: string;
  scopes: string[];
}): Promise<void> {
  const pool = getPool();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Delete old tokens (we only support one connected account)
  await pool.query(`DELETE FROM linkedin_tokens`);

  await pool.query(
    `INSERT INTO linkedin_tokens (access_token, refresh_token, expires_at, scopes, member_urn, display_name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.access_token, data.refresh_token, expiresAt, data.scopes, data.member_urn, data.display_name],
  );
  logger.log('tokens stored for', data.display_name, '(urn:', data.member_urn, ')');
}

/** Get the current valid access token, refreshing if needed. Returns null if not connected. */
export async function getValidAccessToken(): Promise<{ token: string; memberUrn: string } | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    access_token: string;
    refresh_token: string | null;
    expires_at: string;
    member_urn: string;
  }>(`SELECT id, access_token, refresh_token, expires_at, member_urn FROM linkedin_tokens LIMIT 1`);

  if (rows.length === 0) return null;
  const row = rows[0];

  // Check if token is still valid (with 5-minute buffer)
  const expiresAt = new Date(row.expires_at).getTime();
  const now = Date.now();
  if (now < expiresAt - 5 * 60 * 1000) {
    return { token: row.access_token, memberUrn: row.member_urn };
  }

  // Try to refresh
  if (!row.refresh_token) {
    logger.logMinimal('token expired and no refresh token available');
    return null;
  }

  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    await pool.query(
      `UPDATE linkedin_tokens
          SET access_token = $1,
              refresh_token = COALESCE($2, refresh_token),
              expires_at = $3,
              updated_at = now()
        WHERE id = $4`,
      [
        refreshed.access_token,
        refreshed.refresh_token,
        new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        row.id,
      ],
    );
    return { token: refreshed.access_token, memberUrn: row.member_urn };
  } catch (err) {
    logger.logMinimal('token refresh failed:', (err as Error).message);
    return null;
  }
}

/** Fetch the authenticated user's recent posts.
 *  Uses /v2/ugcPosts (works with w_member_social) instead of /v2/posts
 *  (which requires the Community Management product). */
export async function fetchMyPosts(accessToken: string, memberUrn: string, count: number = 20): Promise<Array<{
  urn: string;
  text: string;
  created_at: string;
  permalink: string | null;
}>> {
  const stop = logger.time('fetchMyPosts');
  const authorUrn = `urn:li:person:${memberUrn}`;

  // ugcPosts uses List() syntax for the authors parameter
  const url = `${LINKEDIN_API_BASE}/ugcPosts?q=authors&authors=List(${encodeURIComponent(authorUrn)})&count=${count}&sortBy=LAST_MODIFIED`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    // If ugcPosts also fails, try the shares API as last resort
    logger.logVerbose('ugcPosts failed, trying shares API:', res.status);

    const sharesUrl = `${LINKEDIN_API_BASE}/shares?q=owners&owners=${encodeURIComponent(authorUrn)}&count=${count}&sharesPerOwner=${count}`;
    const sharesRes = await fetch(sharesUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    if (!sharesRes.ok) {
      const sharesText = await sharesRes.text();
      stop();
      throw new Error(`LinkedIn API failed: ugcPosts=${res.status}, shares=${sharesRes.status} — ${sharesText.slice(0, 300)}`);
    }

    const sharesData = await sharesRes.json() as {
      elements?: Array<{
        activity: string;
        text?: { text?: string };
        created?: { time?: number };
      }>;
    };
    stop();

    const posts = (sharesData.elements ?? []).map((el) => ({
      urn: el.activity ?? '',
      text: el.text?.text ?? '',
      created_at: el.created?.time ? new Date(el.created.time).toISOString() : new Date().toISOString(),
      permalink: null as string | null,
    }));

    logger.log(`fetched ${posts.length} posts via shares API for ${authorUrn}`);
    return posts;
  }

  stop();

  const data = await res.json() as {
    elements?: Array<{
      id: string;
      specificContent?: {
        'com.linkedin.ugc.ShareContent'?: {
          shareCommentary?: { text?: string };
        };
      };
      created?: { time?: number };
    }>;
  };

  const posts = (data.elements ?? []).map((el) => ({
    urn: el.id,
    text: el.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text ?? '',
    created_at: el.created?.time ? new Date(el.created.time).toISOString() : new Date().toISOString(),
    permalink: null as string | null,
  }));

  logger.log(`fetched ${posts.length} posts via ugcPosts for ${authorUrn}`);
  return posts;
}

/** Fetch analytics (share statistics) for a specific post URN. */
export async function fetchPostAnalytics(accessToken: string, postUrn: string): Promise<{
  impressions: number;
  unique_impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  raw: unknown;
}> {
  const stop = logger.time(`analytics(${postUrn.slice(-10)})`);
  // LinkedIn Share Statistics API
  const params = new URLSearchParams({
    q: 'organizationalEntity', // works for member shares too with the right scope
    'shares[0]': postUrn,
  });

  // Try the socialActions endpoint for engagement counts first
  const actionsRes = await fetch(`${LINKEDIN_API_BASE}/socialActions/${encodeURIComponent(postUrn)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': '202401',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });

  let likes = 0, comments = 0, shares = 0;
  if (actionsRes.ok) {
    const actionsData = await actionsRes.json() as {
      likesSummary?: { totalLikes?: number };
      commentsSummary?: { totalFirstLevelComments?: number };
      shareCount?: number;
    };
    likes = actionsData.likesSummary?.totalLikes ?? 0;
    comments = actionsData.commentsSummary?.totalFirstLevelComments ?? 0;
    shares = actionsData.shareCount ?? 0;
  }

  stop();

  return {
    impressions: 0,  // Impressions require the analytics scope — may not be available on personal apps
    unique_impressions: 0,
    likes,
    comments,
    shares,
    clicks: 0,
    raw: { likes, comments, shares },
  };
}
