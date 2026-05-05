import { createLogger } from '@/lib/logger';

const logger = createLogger('devto');

const DEVTO_API = 'https://dev.to/api';

export interface DevtoArticleInput {
  title: string;
  bodyMarkdown: string;
  published: boolean;
  tags?: string[];
  canonicalUrl?: string;
}

export interface DevtoArticleResult {
  id: number;
  url: string;
}

/**
 * Publish or draft a Dev.to article. Returns the article URL on success.
 *
 * API docs: https://developers.forem.com/api/v1#tag/articles/operation/createArticle
 * Dev.to tags: lowercase, no spaces, max 4.
 */
export async function publishToDevto(input: DevtoArticleInput): Promise<DevtoArticleResult> {
  const key = process.env.DEVTO_API_KEY;
  if (!key) throw new Error('DEVTO_API_KEY not set');

  const sanitizedTags = (input.tags ?? [])
    .slice(0, 4)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 0);

  const body = {
    article: {
      title: input.title,
      body_markdown: input.bodyMarkdown,
      published: input.published,
      tags: sanitizedTags,
      canonical_url: input.canonicalUrl,
    },
  };

  const stop = logger.time('devto-publish');
  const res = await fetch(`${DEVTO_API}/articles`, {
    method: 'POST',
    headers: {
      'api-key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  stop();

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dev.to publish failed: HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as { id: number; url: string };
  logger.log(`published to Dev.to: ${data.url}`);
  return { id: data.id, url: data.url };
}
