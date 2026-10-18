import crypto from 'node:crypto';
import { createLogger } from '@/lib/logger';
import { getSetting } from '@/lib/settings/read';
import { getSession as getBlueskySession } from '@/lib/bluesky/client';

const logger = createLogger('ingest/external');

export interface ExternalItem {
  externalId: string;
  kind: 'external_signal';
  title: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  occurredAt?: Date;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

const HN_API = 'https://hacker-news.firebaseio.com/v0';

interface HNStory {
  id: number;
  title: string;
  url?: string;
  score: number;
  by: string;
  time: number;
  descendants?: number;
}

async function fetchJSON<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch top/best HackerNews stories. No API key required.
 * Returns items suitable for ingestion as external_signal context.
 */
export async function readHackerNewsStories(limit: number): Promise<ExternalItem[]> {
  const stop = logger.time('hackernews');
  try {
    // /beststories gives a consistently high-signal list
    const storyIds = await fetchJSON<number[]>(`${HN_API}/beststories.json`);
    const fetchCount = Math.min(storyIds.length, limit);

    // Fetch stories in parallel (batches of 10 to avoid overwhelming)
    const items: ExternalItem[] = [];
    for (let i = 0; i < fetchCount; i += 10) {
      const batch = storyIds.slice(i, i + 10);
      const stories = await Promise.allSettled(
        batch.map((id) => fetchJSON<HNStory>(`${HN_API}/item/${id}.json`)),
      );

      for (const result of stories) {
        if (result.status !== 'fulfilled' || !result.value?.title) continue;
        const s = result.value;

        const content = [
          s.title,
          s.url ? `URL: ${s.url}` : '',
          `Score: ${s.score} | Comments: ${s.descendants ?? 0} | By: ${s.by}`,
        ]
          .filter(Boolean)
          .join('\n');

        items.push({
          externalId: `hn-${s.id}`,
          kind: 'external_signal',
          title: s.title,
          content,
          contentHash: sha256(content),
          metadata: {
            source: 'hackernews',
            hn_id: s.id,
            score: s.score,
            comments: s.descendants ?? 0,
            url: s.url ?? null,
          },
          occurredAt: new Date(s.time * 1000),
        });
      }
    }

    stop();
    logger.log(`hackernews: ${items.length} stories fetched`);
    return items;
  } catch (err) {
    stop();
    logger.logMinimal('hackernews fetch failed:', (err as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// arXiv — Atom feed for recent papers
// ---------------------------------------------------------------------------

const ARXIV_API = 'http://export.arxiv.org/api/query';

/**
 * Fetch recent arXiv papers from specified categories.
 * arXiv returns Atom XML; we parse with simple regex (stable format).
 */
export async function readArxivPapers(limit?: number): Promise<ExternalItem[]> {
  const categories = await getSetting<string[]>('ingest.arxiv_categories', ['cs.AI', 'cs.CR', 'cs.LG', 'cs.MA']);
  const maxResults = limit ?? await getSetting<number>('ingest.arxiv_limit', 30);

  const stop = logger.time('arxiv');
  try {
    const catQuery = categories.map((c) => `cat:${c}`).join('+OR+');
    const url = `${ARXIV_API}?search_query=${catQuery}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
    const xml = await res.text();

    const items: ExternalItem[] = [];
    // Parse <entry> blocks from Atom feed
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];
      const extract = (tag: string) => {
        const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].trim() : '';
      };

      const title = extract('title').replace(/\s+/g, ' ');
      const summary = extract('summary').replace(/\s+/g, ' ');
      const idUrl = extract('id'); // e.g., http://arxiv.org/abs/2401.12345v1
      const arxivId = idUrl.replace(/^.*\/abs\//, '').replace(/v\d+$/, '');
      const published = extract('published');

      // Extract authors
      const authorRegex = /<author>\s*<name>([^<]+)<\/name>/g;
      const authors: string[] = [];
      let am;
      while ((am = authorRegex.exec(entry)) !== null) authors.push(am[1].trim());

      // Extract categories
      const catRegex = /category[^>]*term="([^"]+)"/g;
      const cats: string[] = [];
      let cm;
      while ((cm = catRegex.exec(entry)) !== null) cats.push(cm[1]);

      if (!title || !summary) continue;

      const content = `${title}\n\nAuthors: ${authors.join(', ')}\nCategories: ${cats.join(', ')}\n\n${summary}`;
      const pdfUrl = idUrl.replace('/abs/', '/pdf/');

      items.push({
        externalId: `arxiv-${arxivId}`,
        kind: 'external_signal',
        title,
        content,
        contentHash: sha256(content),
        metadata: { source: 'arxiv', arxiv_id: arxivId, categories: cats, authors, pdf_url: pdfUrl },
        occurredAt: published ? new Date(published) : undefined,
      });
    }

    stop();
    logger.log(`arxiv: ${items.length} papers from ${categories.join(', ')}`);
    return items;
  } catch (err) {
    stop();
    logger.logMinimal('arxiv fetch failed:', (err as Error).message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// RSS/Atom — Generic feed reader
// ---------------------------------------------------------------------------

interface RssFeed {
  name: string;
  url: string;
}

function stripHtml(html: string): string {
  // Plain-text extraction for feed content; output is never rendered as
  // HTML. Remove script/style blocks and strip tags until stable so split
  // or nested tags cannot survive, then decode entities with &amp; last.
  let text = html;
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  } while (text !== prev);
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, ' ');
  } while (text !== prev);
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read items from curated RSS/Atom feeds. Handles both RSS 2.0 (<item>) and Atom (<entry>).
 */
export async function readRssFeeds(): Promise<ExternalItem[]> {
  const feeds = await getSetting<RssFeed[]>('ingest.rss_feeds', []);
  const limitPerFeed = await getSetting<number>('ingest.rss_limit_per_feed', 10);

  if (feeds.length === 0) return [];

  const stop = logger.time('rss');
  const allItems: ExternalItem[] = [];

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        logger.logMinimal(`rss ${feed.name}: HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();

      const feedItems: ExternalItem[] = [];

      // Try RSS 2.0 (<item>) first, then Atom (<entry>)
      const isAtom = xml.includes('<feed') && xml.includes('<entry>');
      const itemRegex = isAtom ? /<entry>([\s\S]*?)<\/entry>/g : /<item>([\s\S]*?)<\/item>/g;

      let match;
      while ((match = itemRegex.exec(xml)) !== null && feedItems.length < limitPerFeed) {
        const block = match[1];
        const extract = (tag: string) => {
          // Handle CDATA and regular content
          const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
          return m ? m[1].trim() : '';
        };

        const title = stripHtml(extract('title'));
        const link = isAtom
          ? (block.match(/href="([^"]+)"/) ?? [])[1] ?? ''
          : extract('link');
        const description = stripHtml(
          extract(isAtom ? 'summary' : 'description') || extract('content'),
        );
        const pubDate = extract(isAtom ? 'updated' : 'pubDate');

        if (!title || !link) continue;

        const content = `${title}\n\nSource: ${feed.name}\nURL: ${link}\n\n${description.slice(0, 2000)}`;
        const linkHash = sha256(link).slice(0, 12);

        feedItems.push({
          externalId: `rss-${feed.name.toLowerCase().replace(/\s+/g, '-')}-${linkHash}`,
          kind: 'external_signal',
          title,
          content,
          contentHash: sha256(content),
          metadata: { source: 'rss', feed_name: feed.name, url: link, pub_date: pubDate },
          occurredAt: pubDate ? new Date(pubDate) : undefined,
        });
      }

      allItems.push(...feedItems);
      logger.logVerbose(`rss ${feed.name}: ${feedItems.length} items`);
    } catch (err) {
      logger.logMinimal(`rss ${feed.name} failed:`, (err as Error).message);
    }
  }

  stop();
  logger.log(`rss: ${allItems.length} items from ${feeds.length} feeds`);
  return allItems;
}

// ---------------------------------------------------------------------------
// Bluesky — Public search for trending posts
// ---------------------------------------------------------------------------

// Bluesky's `public.api.bsky.app` started returning 403 to all requests in early 2026 (likely
// CDN-level deprecation of the unauthenticated path). The authenticated `bsky.social` endpoint
// still serves searchPosts; reusing the publish-side BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD
// credentials. Session is cached for ~2 hours by getSession().
const BSKY_AUTH_API = 'https://bsky.social/xrpc';

interface BskySearchPost {
  uri: string;
  cid: string;
  author: { handle: string; did: string; displayName?: string };
  record: { text: string; createdAt: string };
  likeCount?: number;
  repostCount?: number;
}

/**
 * Search Bluesky for posts matching configured keywords via the authenticated AT Protocol API.
 * Filters by engagement threshold. Reuses publish-side credentials; session cached.
 */
export async function readBlueskySignals(): Promise<ExternalItem[]> {
  const keywords = await getSetting<string[]>('ingest.bluesky_search_keywords', []);
  const minEngagement = await getSetting<number>('ingest.bluesky_min_engagement', 5);
  const limit = await getSetting<number>('ingest.bluesky_search_limit', 20);

  if (keywords.length === 0) return [];

  const stop = logger.time('bluesky-search');
  const seen = new Set<string>();
  const allItems: ExternalItem[] = [];

  // Authenticate once for the whole search loop; getSession caches the JWT.
  let accessJwt: string;
  try {
    const session = await getBlueskySession();
    accessJwt = session.accessJwt;
  } catch (err) {
    logger.logMinimal('bluesky auth failed:', (err as Error).message);
    stop();
    return [];
  }

  // Only fetch posts from the last 7 days to avoid re-processing old content
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const keyword of keywords) {
    try {
      const searchUrl = `${BSKY_AUTH_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(keyword)}&limit=25&sort=top&since=${since}`;
      const res = await fetch(searchUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'Authorization': `Bearer ${accessJwt}` },
      });
      if (!res.ok) {
        logger.logMinimal(`bluesky search "${keyword}": HTTP ${res.status}`);
        continue;
      }
      const data = await res.json() as { posts?: BskySearchPost[] };
      const posts = data.posts ?? [];

      for (const post of posts) {
        const engagement = (post.likeCount ?? 0) + (post.repostCount ?? 0);
        if (engagement < minEngagement) continue;

        const uriHash = sha256(post.uri).slice(0, 12);
        if (seen.has(uriHash)) continue;
        seen.add(uriHash);

        if (allItems.length >= limit) break;

        const text = post.record.text;
        const author = post.author.displayName ?? post.author.handle;
        const content = `${text}\n\nBy: @${post.author.handle} (${author})\nLikes: ${post.likeCount ?? 0} | Reposts: ${post.repostCount ?? 0}`;

        // Build Bluesky web URL from AT URI
        const rkey = post.uri.split('/').pop() ?? '';
        const postUrl = `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;

        allItems.push({
          externalId: `bsky-${uriHash}`,
          kind: 'external_signal',
          title: text.slice(0, 120) + (text.length > 120 ? '…' : ''),
          content,
          contentHash: sha256(content),
          metadata: {
            source: 'bluesky',
            author_handle: post.author.handle,
            author_did: post.author.did,
            uri: post.uri,
            url: postUrl,
            like_count: post.likeCount ?? 0,
            repost_count: post.repostCount ?? 0,
            keyword,
          },
          occurredAt: post.record.createdAt ? new Date(post.record.createdAt) : undefined,
        });
      }
    } catch (err) {
      logger.logMinimal(`bluesky search "${keyword}" failed:`, (err as Error).message);
    }
  }

  stop();
  logger.log(`bluesky-search: ${allItems.length} posts from ${keywords.length} keywords (min engagement: ${minEngagement})`);
  return allItems;
}
