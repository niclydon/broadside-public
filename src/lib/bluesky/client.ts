// Bluesky publishing client via the AT Protocol.
// Auth: app password (not OAuth). Create one at https://bsky.app/settings/app-passwords
// The AT Protocol is simple HTTP + JWT — no SDK needed.

import { createLogger } from '@/lib/logger';

const logger = createLogger('bluesky');

const BSKY_API = 'https://bsky.social/xrpc';

interface Session {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

const sessionCache = new Map<string, Session>();
const sessionExpiry = new Map<string, number>();

function getCredentials(brandSlug?: string): { identifier: string; password: string } {
  if (brandSlug === 'broadcast') {
    const identifier = process.env.BLUESKY_IDENTIFIER_SIGNAL_CAST;
    const password = process.env.BLUESKY_APP_PASSWORD_SIGNAL_CAST;
    if (!identifier || !password) {
      throw new Error('BLUESKY_IDENTIFIER_SIGNAL_CAST and BLUESKY_APP_PASSWORD_SIGNAL_CAST not set');
    }
    return { identifier, password };
  }
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) {
    throw new Error('BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD not set');
  }
  return { identifier, password };
}

/** Create or refresh a session. Sessions last ~2 hours. */
export async function getSession(brandSlug = 'default'): Promise<Session> {
  const cached = sessionCache.get(brandSlug);
  const expires = sessionExpiry.get(brandSlug) ?? 0;
  if (cached && Date.now() < expires - 60_000) {
    return cached;
  }

  const { identifier, password } = getCredentials(brandSlug === 'default' ? undefined : brandSlug);
  const stop = logger.time('createSession');
  const res = await fetch(`${BSKY_API}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  stop();

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bluesky auth failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = await res.json() as Session;
  sessionCache.set(brandSlug, data);
  sessionExpiry.set(brandSlug, Date.now() + 110 * 60 * 1000);
  logger.log(`Bluesky session created for ${brandSlug}: ${data.handle} (${data.did})`);
  return data;
}

/** Detect facets (links, mentions, hashtags) in text for Bluesky rich text. */
function detectFacets(text: string): Array<{
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; [key: string]: unknown }>;
}> {
  const encoder = new TextEncoder();
  const facets: Array<{
    index: { byteStart: number; byteEnd: number };
    features: Array<{ $type: string; [key: string]: unknown }>;
  }> = [];

  // URLs
  const urlRegex = /https?:\/\/[^\s<>)"']+/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const byteStart = encoder.encode(before).length;
    const byteEnd = byteStart + encoder.encode(match[0]).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }],
    });
  }

  // Hashtags
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
  while ((match = hashtagRegex.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const byteStart = encoder.encode(before).length;
    const byteEnd = byteStart + encoder.encode(match[0]).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: match[1] }],
    });
  }

  // Mentions (@handle.bsky.social)
  const mentionRegex = /@([a-zA-Z0-9._-]+\.[a-zA-Z]+)/g;
  while ((match = mentionRegex.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const byteStart = encoder.encode(before).length;
    const byteEnd = byteStart + encoder.encode(match[0]).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did: match[1] }],
    });
  }

  return facets;
}

/** Upload a blob (image) to Bluesky and return the blob ref. */
export async function uploadBlob(data: Buffer, mimeType: string, brandSlug?: string): Promise<{ $type: 'blob'; ref: { $link: string }; mimeType: string; size: number }> {
  const session = await getSession(brandSlug);
  const stop = logger.time('uploadBlob');
  const res = await fetch(`${BSKY_API}/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: {
      'Content-Type': mimeType,
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: new Uint8Array(data),
  });
  stop();

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bluesky blob upload failed: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }

  const result = await res.json() as { blob: { $type: 'blob'; ref: { $link: string }; mimeType: string; size: number } };
  logger.log('uploaded blob:', result.blob.mimeType, result.blob.size, 'bytes');
  return result.blob;
}

export interface BlueskyPublishResult {
  uri: string;    // at:// URI of the created post
  cid: string;    // content ID
  postUrl: string; // public web URL
}

export interface BlueskyReplyRef {
  root: { uri: string; cid: string };
  parent: { uri: string; cid: string };
}

/** Publish a text post to Bluesky, optionally with images and/or as a reply. */
export async function publishToBluesky(
  text: string,
  images?: Array<{ blob: { $type: string; ref: { $link: string }; mimeType: string; size: number }; alt: string }>,
  reply?: BlueskyReplyRef,
  brandSlug?: string,
): Promise<BlueskyPublishResult> {
  const session = await getSession(brandSlug);
  const facets = detectFacets(text);

  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text,
    facets: facets.length > 0 ? facets : undefined,
    createdAt: new Date().toISOString(),
  };

  if (images && images.length > 0) {
    record.embed = {
      $type: 'app.bsky.embed.images',
      images: images.slice(0, 4).map((img) => ({
        image: img.blob,
        alt: img.alt,
      })),
    };
  }

  if (reply) {
    record.reply = reply;
  }

  const stop = logger.time('createPost');
  const res = await fetch(`${BSKY_API}/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });
  stop();

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bluesky publish failed: HTTP ${res.status} — ${errText.slice(0, 400)}`);
  }

  const data = await res.json() as { uri: string; cid: string };

  // Construct the public URL: at://did:plc:xxx/app.bsky.feed.post/rkey → https://bsky.app/profile/handle/post/rkey
  const rkey = data.uri.split('/').pop() ?? '';
  const postUrl = `https://bsky.app/profile/${session.handle}/post/${rkey}`;

  logger.log(reply ? 'published Bluesky reply:' : 'published to Bluesky:', postUrl);
  return { uri: data.uri, cid: data.cid, postUrl };
}

/**
 * Publish a multi-part thread to Bluesky. The first part is the root; each
 * subsequent part replies to the previous while all share the same root ref.
 */
export async function publishBlueskyThread(parts: string[], brandSlug?: string): Promise<{
  rootUri: string;
  rootUrl: string;
  uris: string[];
}> {
  if (parts.length === 0) throw new Error('thread must have at least one part');
  const stop = logger.time('publishBlueskyThread');

  const first = await publishToBluesky(parts[0], undefined, undefined, brandSlug);
  const uris: string[] = [first.uri];
  const root = { uri: first.uri, cid: first.cid };
  let parent = { uri: first.uri, cid: first.cid };

  for (let i = 1; i < parts.length; i++) {
    await new Promise(r => setTimeout(r, 500));
    const next = await publishToBluesky(parts[i], undefined, { root, parent }, brandSlug);
    uris.push(next.uri);
    parent = { uri: next.uri, cid: next.cid };
  }

  stop();
  logger.log(`posted ${parts.length}-part thread to Bluesky, root: ${first.postUrl}`);
  return { rootUri: first.uri, rootUrl: first.postUrl, uris };
}
