import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scrubSecrets } from './scrub';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ingest/github');

const GH_API = 'https://api.github.com';

export interface GitHubFileItem {
  repoName: string;
  kind: 'readme' | 'claude_md' | 'agents_md' | 'changes_md' | 'doc' | 'neutral_doc';
  externalId: string;
  title: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  occurredAt?: Date;
}

export interface GitHubCommitItem {
  repoName: string;
  externalId: string;
  title: string;
  content: string;
  contentHash: string;
  metadata: {
    repo: string;
    author: string;
    sha: string;
    short_sha: string;
  };
  occurredAt: Date;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function stripGeneratedAgentBlocks(input: string): string {
  return input
    .replace(
      /<!-- generated:agent-neutral-workspace:start -->[\s\S]*?<!-- generated:agent-neutral-workspace:end -->\n?/g,
      '',
    )
    .trim();
}

function getToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN environment variable is required');
  return token;
}

async function ghFetch<T>(path: string, opts?: { accept?: string }): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${GH_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: opts?.accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub ${res.status}: ${path} — ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch raw file content via the GitHub contents API. Returns null if not found. */
async function fetchFileContent(owner: string, repo: string, filePath: string, maxBytes: number): Promise<{ content: string; lastModified?: Date } | null> {
  try {
    const data = await ghFetch<{
      content?: string;
      encoding?: string;
      size: number;
      sha: string;
    }>(`/repos/${owner}/${repo}/contents/${filePath}`);

    if (!data.content || data.encoding !== 'base64') return null;
    if (data.size > maxBytes) {
      logger.logVerbose(`${repo}/${filePath}: ${data.size} bytes exceeds max ${maxBytes}, truncating`);
    }

    const decoded = Buffer.from(data.content, 'base64').toString('utf-8').slice(0, maxBytes);

    // Get last commit date for this file as occurred_at
    let lastModified: Date | undefined;
    try {
      const commits = await ghFetch<Array<{ commit: { committer: { date: string } } }>>(
        `/repos/${owner}/${repo}/commits?path=${encodeURIComponent(filePath)}&per_page=1`,
      );
      if (commits.length > 0) {
        lastModified = new Date(commits[0].commit.committer.date);
      }
    } catch {
      // non-critical — just won't have occurred_at
    }

    return { content: decoded, lastModified };
  } catch {
    return null;
  }
}

interface GHRepo {
  name: string;
  full_name: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  pushed_at: string | null;
  default_branch: string;
  owner: { login: string };
}

/** List all repos for the authenticated user (handles pagination). */
async function listAllRepos(): Promise<GHRepo[]> {
  const repos: GHRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const batch = await ghFetch<GHRepo[]>(
      `/user/repos?per_page=${perPage}&page=${page}&sort=pushed&direction=desc&affiliation=owner`,
    );
    repos.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }

  return repos;
}

/** File targets to pull from each repo — same set as the old local walker. */
const DOC_FILE_MAP: { path: string; kind: GitHubFileItem['kind'] }[] = [
  { path: 'README.md', kind: 'readme' },
  { path: 'README.rst', kind: 'readme' },
  { path: 'README.txt', kind: 'readme' },
  { path: 'CLAUDE.md', kind: 'claude_md' },
  { path: 'CLAUDE.local.md', kind: 'claude_md' },
  { path: 'AGENTS.md', kind: 'agents_md' },
  { path: 'CHANGES.md', kind: 'changes_md' },
  { path: 'CHANGELOG.md', kind: 'changes_md' },
  { path: 'RELEASES.md', kind: 'changes_md' },
  { path: 'HISTORY.md', kind: 'changes_md' },
];

/**
 * Ingest doc files from all GitHub repos owned by the authenticated user.
 * Replaces the local filesystem project walker.
 */
export async function readGitHubRepoFiles(opts: {
  maxFileBytes: number;
  blacklistRepos: Set<string>;
}): Promise<{ items: GitHubFileItem[]; repoCount: number }> {
  const stop = logger.time('github-files');
  try {
    const repos = await listAllRepos();
    const active = repos.filter(
      (r) => !r.fork && !r.archived && !r.disabled && !opts.blacklistRepos.has(r.name),
    );
    logger.log(`github: ${active.length} active repos (${repos.length} total)`);

    const items: GitHubFileItem[] = [];

    for (const repo of active) {
      const owner = repo.owner.login;

      // Fetch known doc files
      for (const { path, kind } of DOC_FILE_MAP) {
        const result = await fetchFileContent(owner, repo.name, path, opts.maxFileBytes);
        if (!result) continue;

        const stripped = kind === 'claude_md' || kind === 'agents_md'
          ? stripGeneratedAgentBlocks(result.content)
          : result.content;
        if (!stripped.trim()) continue;
        const scrubbed = scrubSecrets(stripped);
        items.push({
          repoName: repo.name,
          kind,
          externalId: `${repo.name}/${path}`,
          title: `${repo.name}/${path}`,
          content: scrubbed.text,
          contentHash: sha256(scrubbed.text),
          metadata: {
            repo: repo.name,
            file: path,
            github_url: `https://github.com/${repo.full_name}/blob/${repo.default_branch}/${path}`,
            scrubbed: scrubbed.redacted,
          },
          occurredAt: result.lastModified,
        });
      }

      // Fetch docs/ directory (up to 10 .md files)
      try {
        const dirContents = await ghFetch<Array<{ name: string; type: string; path: string; size: number }>>(
          `/repos/${owner}/${repo.name}/contents/docs`,
        );
        const mdFiles = dirContents
          .filter((f) => f.type === 'file' && f.name.endsWith('.md'))
          .slice(0, 10);

        for (const f of mdFiles) {
          const result = await fetchFileContent(owner, repo.name, f.path, opts.maxFileBytes);
          if (!result) continue;

          const scrubbed = scrubSecrets(result.content);
          items.push({
            repoName: repo.name,
            kind: 'doc',
            externalId: `${repo.name}/${f.path}`,
            title: `${repo.name}/${f.path}`,
            content: scrubbed.text,
            contentHash: sha256(scrubbed.text),
            metadata: {
              repo: repo.name,
              file: f.path,
              github_url: `https://github.com/${repo.full_name}/blob/${repo.default_branch}/${f.path}`,
              scrubbed: scrubbed.redacted,
            },
            occurredAt: result.lastModified,
          });
        }
      } catch {
        // No docs/ directory — that's fine
      }
    }

    stop();
    logger.log(`github files: ${items.length} items from ${active.length} repos`);
    return { items, repoCount: active.length };
  } catch (err) {
    stop();
    logger.logMinimal('github file ingestion failed:', (err as Error).message);
    return { items: [], repoCount: 0 };
  }
}

const NEUTRAL_ROOT_DOCS = [
  'CODE.md',
  'LOGGING.md',
  'GIT.md',
  'SECURITY.md',
  'BRANDING.md',
];

export async function readNeutralRootDocs(opts: {
  maxFileBytes: number;
  workspaceRoot?: string;
}): Promise<GitHubFileItem[]> {
  const workspaceRoot = opts.workspaceRoot ?? process.env.PROJECTS_ROOT ?? '/workspace';
  const items: GitHubFileItem[] = [];
  for (const relPath of NEUTRAL_ROOT_DOCS) {
    const filePath = path.join(workspaceRoot, relPath);
    try {
      const raw = (await fs.readFile(filePath, 'utf8')).slice(0, opts.maxFileBytes);
      const scrubbed = scrubSecrets(raw);
      items.push({
        repoName: 'agent-neutral-workspace',
        kind: 'neutral_doc',
        externalId: `agent-neutral-workspace/${relPath}`,
        title: `agent-neutral-workspace/${relPath}`,
        content: scrubbed.text,
        contentHash: sha256(scrubbed.text),
        metadata: {
          repo: 'agent-neutral-workspace',
          file: relPath,
          local_path: filePath,
          scrubbed: scrubbed.redacted,
        },
      });
    } catch {
      logger.logVerbose(`neutral doc missing: ${filePath}`);
    }
  }
  return items;
}

/**
 * Read recent commits from all GitHub repos owned by the authenticated user.
 * Replaces the local git log reader.
 */
export async function readGitHubCommits(opts: {
  commitLimit: number;
  blacklistRepos: Set<string>;
}): Promise<GitHubCommitItem[]> {
  const stop = logger.time('github-commits');
  try {
    const repos = await listAllRepos();
    const active = repos.filter(
      (r) => !r.fork && !r.archived && !r.disabled && !opts.blacklistRepos.has(r.name),
    );

    const items: GitHubCommitItem[] = [];

    for (const repo of active) {
      try {
        const commits = await ghFetch<Array<{
          sha: string;
          commit: {
            message: string;
            author: { name: string; date: string };
          };
        }>>(`/repos/${repo.owner.login}/${repo.name}/commits?per_page=${Math.min(opts.commitLimit, 100)}`);

        for (const c of commits) {
          const rawMessage = c.commit.message;
          const subject = rawMessage.split('\n')[0] ?? '';
          const scrubbed = scrubSecrets(rawMessage);

          items.push({
            repoName: repo.name,
            externalId: c.sha,
            title: subject,
            content: scrubbed.text,
            contentHash: sha256(scrubbed.text),
            metadata: {
              repo: repo.name,
              author: c.commit.author.name,
              sha: c.sha,
              short_sha: c.sha.slice(0, 10),
            },
            occurredAt: new Date(c.commit.author.date),
          });
        }
        logger.logVerbose(`${repo.name}: ${commits.length} commits`);
      } catch (err) {
        logger.logVerbose(`${repo.name} commits failed: ${(err as Error).message}`);
      }
    }

    stop();
    logger.log(`github commits: ${items.length} across ${active.length} repos`);
    return items;
  } catch (err) {
    stop();
    logger.logMinimal('github commit ingestion failed:', (err as Error).message);
    return [];
  }
}
