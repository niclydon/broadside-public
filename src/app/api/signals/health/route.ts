import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings/read';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/signals/health');

export const dynamic = 'force-dynamic';

interface FeedConfig {
  name: string;
  url: string;
}

export async function GET() {
  const feeds = await getSetting<FeedConfig[]>('ingest.rss_feeds', []);
  const arxivEnabled = await getSetting<boolean>('ingest.arxiv_enabled', true);
  const bskyEnabled = await getSetting<boolean>('ingest.bluesky_search_enabled', true);

  const results: Array<{ name: string; type: string; url: string; ok: boolean; status?: number; error?: string; ms: number }> = [];

  // Check RSS feeds
  for (const feed of feeds) {
    const start = Date.now();
    try {
      const res = await fetch(feed.url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
      results.push({ name: feed.name, type: 'rss', url: feed.url, ok: res.ok, status: res.status, ms: Date.now() - start });
    } catch (err) {
      results.push({ name: feed.name, type: 'rss', url: feed.url, ok: false, error: (err as Error).message, ms: Date.now() - start });
    }
  }

  // Check arXiv
  if (arxivEnabled) {
    const start = Date.now();
    try {
      const res = await fetch('http://export.arxiv.org/api/query?search_query=cat:cs.AI&max_results=1', { signal: AbortSignal.timeout(10_000) });
      results.push({ name: 'arXiv', type: 'arxiv', url: 'export.arxiv.org', ok: res.ok, status: res.status, ms: Date.now() - start });
    } catch (err) {
      results.push({ name: 'arXiv', type: 'arxiv', url: 'export.arxiv.org', ok: false, error: (err as Error).message, ms: Date.now() - start });
    }
  }

  // Check Bluesky search
  if (bskyEnabled) {
    const start = Date.now();
    try {
      const res = await fetch('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=test&limit=1', { signal: AbortSignal.timeout(10_000) });
      results.push({ name: 'Bluesky Search', type: 'bluesky', url: 'public.api.bsky.app', ok: res.ok, status: res.status, ms: Date.now() - start });
    } catch (err) {
      results.push({ name: 'Bluesky Search', type: 'bluesky', url: 'public.api.bsky.app', ok: false, error: (err as Error).message, ms: Date.now() - start });
    }
  }

  // Check HN
  {
    const start = Date.now();
    try {
      const res = await fetch('https://hacker-news.firebaseio.com/v0/beststories.json?limitToFirst=1&orderBy=%22$key%22', { signal: AbortSignal.timeout(10_000) });
      results.push({ name: 'HackerNews', type: 'hackernews', url: 'hacker-news.firebaseio.com', ok: res.ok, status: res.status, ms: Date.now() - start });
    } catch (err) {
      results.push({ name: 'HackerNews', type: 'hackernews', url: 'hacker-news.firebaseio.com', ok: false, error: (err as Error).message, ms: Date.now() - start });
    }
  }

  const healthy = results.filter((r) => r.ok).length;
  logger.log(`signal health: ${healthy}/${results.length} sources reachable`);

  return NextResponse.json({ sources: results, healthy, total: results.length });
}
