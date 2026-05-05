import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scrubSecrets } from './scrub';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ingest/git');
const pExecFile = promisify(execFile);

export interface GitCommitItem {
  repoName: string;
  externalId: string;              // commit sha
  title: string;                   // first line of message
  content: string;                 // full scrubbed message
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

/** Read up to `limit` commits from a single git repo at `repoDir`. */
export async function readGitLog(
  repoDir: string,
  limit: number,
): Promise<GitCommitItem[]> {
  const gitDir = path.join(repoDir, '.git');
  if (!fs.existsSync(gitDir)) return [];

  const repoName = path.basename(repoDir);
  try {
    // Use a rare record-separator so we can parse multi-line messages safely.
    const sep = '<<<BS-RSEP>>>';
    const fieldSep = '<<<BS-FSEP>>>';
    const format = `%H${fieldSep}%aI${fieldSep}%an${fieldSep}%s${fieldSep}%b${sep}`;

    const { stdout } = await pExecFile(
      'git',
      ['log', `--pretty=format:${format}`, `-n`, String(limit)],
      { cwd: repoDir, maxBuffer: 16 * 1024 * 1024 },
    );

    const items: GitCommitItem[] = [];
    for (const chunk of stdout.split(sep)) {
      const trimmed = chunk.replace(/^\n+/, '');
      if (!trimmed) continue;
      const [sha, iso, author, subject, body] = trimmed.split(fieldSep);
      if (!sha) continue;

      const rawMessage = body ? `${subject}\n\n${body}` : subject;
      const scrubbed = scrubSecrets(rawMessage);

      items.push({
        repoName,
        externalId: sha,
        title: subject ?? '',
        content: scrubbed.text,
        contentHash: sha256(scrubbed.text),
        metadata: {
          repo: repoName,
          author: author ?? '',
          sha,
          short_sha: sha.slice(0, 10),
        },
        occurredAt: new Date(iso),
      });
    }

    logger.logVerbose(`${repoName}: ${items.length} commits`);
    return items;
  } catch (err) {
    logger.logMinimal(`git log failed for ${repoName}:`, (err as Error).message);
    return [];
  }
}

export async function readAllGitLogs(
  projectsRoot: string,
  limit: number,
  blacklistFolders: Set<string>,
): Promise<GitCommitItem[]> {
  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !blacklistFolders.has(e.name))
      .map((e) => path.join(projectsRoot, e.name));
  } catch (err) {
    logger.logMinimal('readdir failed:', (err as Error).message);
    return [];
  }

  const all: GitCommitItem[] = [];
  for (const dir of entries) {
    const items = await readGitLog(dir, limit);
    all.push(...items);
  }
  logger.log(`readAllGitLogs: ${all.length} commits across ${entries.length} dirs`);
  return all;
}
