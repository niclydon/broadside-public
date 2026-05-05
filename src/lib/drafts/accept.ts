import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';

const logger = createLogger('drafts/accept');

interface AcceptResult {
  content_group_id: string;
  post_ids: string[];
}

/**
 * Accepting a candidate materialises it as a content_group + a single post
 * targeting whichever platform the candidate was drafted for. The user can add
 * a second-platform variant via the editor later if they want.
 */
export async function acceptDraftCandidate(candidateId: string): Promise<AcceptResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: candidateRows } = await client.query<{
      id: string;
      generation_id: string;
      topic_slug: string | null;
      hook: string | null;
      body: string;
      rationale: string | null;
      cited_item_ids: string[];
      accepted: boolean;
      rejected: boolean;
    }>(
      `SELECT id, generation_id, topic_slug, hook, body, rationale, cited_item_ids, accepted, rejected
         FROM draft_candidates WHERE id = $1 FOR UPDATE`,
      [candidateId],
    );
    if (candidateRows.length === 0) throw new Error(`candidate ${candidateId} not found`);
    const cand = candidateRows[0];
    if (cand.accepted) throw new Error('candidate already accepted');
    if (cand.rejected) throw new Error('candidate already rejected');

    // Resolve topic id from topic_slug if possible.
    let topicId: string | null = null;
    if (cand.topic_slug) {
      const { rows: tRows } = await client.query<{ id: string }>(
        `SELECT id FROM topics WHERE slug = $1`,
        [cand.topic_slug],
      );
      if (tRows.length > 0) topicId = tRows[0].id;
    }

    // Extract platform id from the rationale marker we stashed in generate.ts: "[linkedin ...]"
    const platformMatch = cand.rationale?.match(/^\[(\w+)(?:\s*\|[^\]]*)?\]/);
    const platformId = platformMatch?.[1] ?? 'linkedin';

    // Strip the [platform] prefix from the rationale for the notes field.
    const cleanRationale = cand.rationale?.replace(/^\[[^\]]+\]\s*/, '') ?? null;

    // Extract substack title from the rationale marker: "[substack | "title"]"
    const titleMatch = cand.rationale?.match(/^\[substack\s*\|\s*"([^"]+)"\]/);
    const title = titleMatch?.[1] ?? null;

    // Create the content_group. Inherit brand from the draft_generation that
    // produced this candidate — it's the brand that was active when the draft ran.
    const { rows: cgRows } = await client.query<{ id: string }>(
      `INSERT INTO content_groups (brand_id, topic_id, status, source, notes)
       SELECT COALESCE(dg.brand_id, (SELECT id FROM brands WHERE slug = 'studio')),
              $1, 'draft', 'ai_draft', $2
         FROM draft_generations dg
        WHERE dg.id = $3
       RETURNING id`,
      [topicId, cleanRationale, cand.generation_id],
    );
    const contentGroupId = cgRows[0].id;

    // Create a single post for the platform this candidate targeted.
    const { rows: postRows } = await client.query<{ id: string }>(
      `INSERT INTO posts (content_group_id, platform_id, title, body, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING id`,
      [contentGroupId, platformId, title, cand.body],
    );

    // Mark the candidate accepted and link it.
    await client.query(
      `UPDATE draft_candidates
          SET accepted = true, content_group_id = $1
        WHERE id = $2`,
      [contentGroupId, candidateId],
    );

    await client.query('COMMIT');
    logger.log(`accepted ${candidateId} → content_group ${contentGroupId} (${platformId})`);
    return { content_group_id: contentGroupId, post_ids: [postRows[0].id] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectDraftCandidate(candidateId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE draft_candidates SET rejected = true WHERE id = $1 AND NOT accepted`,
    [candidateId],
  );
  logger.log(`rejected ${candidateId}`);
}
