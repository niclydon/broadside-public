import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/pool';
import { createLogger } from '@/lib/logger';
import { getSetting } from '@/lib/settings/read';
import { sendEmail } from '@/lib/newsletter/client';
import { markdownToHtml, wrapEmailHtml } from '@/lib/markdown';

const logger = createLogger('api/posts/newsletter');

export const dynamic = 'force-dynamic';

interface PostRow {
  id: string;
  platform_id: string;
  title: string | null;
  body: string;
  body_html: string | null;
  status: string;
}

interface SubscriberRow {
  id: string;
  email: string;
  name: string | null;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const pool = getPool();
  const { rows: postRows } = await pool.query<PostRow>(
    `SELECT id, platform_id, title, body, body_html, status FROM posts WHERE id = $1`,
    [id],
  );
  if (postRows.length === 0) {
    return NextResponse.json({ error: 'post not found' }, { status: 404 });
  }
  const post = postRows[0];
  if (post.platform_id !== 'newsletter') {
    return NextResponse.json(
      { error: `post is on ${post.platform_id}, not newsletter` },
      { status: 400 },
    );
  }
  if (!post.title || !post.title.trim()) {
    return NextResponse.json({ error: 'newsletter posts require a title (subject)' }, { status: 400 });
  }
  if (!post.body || !post.body.trim()) {
    return NextResponse.json({ error: 'post body is empty' }, { status: 400 });
  }

  const fromAddress = await getSetting<string>('newsletter.from_address', '');
  if (!fromAddress) {
    return NextResponse.json(
      { error: 'newsletter.from_address is not configured. Set it in Settings.' },
      { status: 400 },
    );
  }
  const fromName = await getSetting<string>('newsletter.from_name', '');
  const replyTo = await getSetting<string>('newsletter.reply_to', '');
  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

  // Pull active subscribers
  const { rows: subscribers } = await pool.query<SubscriberRow>(
    `SELECT id, email, name FROM newsletter_subscribers
      WHERE unsubscribed_at IS NULL
      ORDER BY subscribed_at ASC`,
  );

  if (subscribers.length === 0) {
    return NextResponse.json({ error: 'no active subscribers' }, { status: 400 });
  }

  // Skip already-sent recipients so re-publishing is idempotent per subscriber
  const { rows: alreadySent } = await pool.query<{ subscriber_id: string }>(
    `SELECT subscriber_id FROM newsletter_sends WHERE post_id = $1`,
    [id],
  );
  const sentSet = new Set(alreadySent.map(r => r.subscriber_id));
  const recipients = subscribers.filter(s => !sentSet.has(s.id));

  if (recipients.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      failed: 0,
      skipped: subscribers.length,
      message: 'all subscribers already received this post',
    });
  }

  logger.log(`sending post ${id} to ${recipients.length} subscribers (${sentSet.size} already received)`);

  const bodyHtml = post.body_html ?? markdownToHtml(post.body);
  const html = wrapEmailHtml(post.title, bodyHtml);
  const text = post.body;

  let sent = 0;
  let failed = 0;

  for (const sub of recipients) {
    const result = await sendEmail({
      from,
      to: sub.email,
      subject: post.title,
      html,
      text,
      replyTo: replyTo || undefined,
    });

    await pool.query(
      `INSERT INTO newsletter_sends (post_id, subscriber_id, resend_id, status, error)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (post_id, subscriber_id) DO NOTHING`,
      [id, sub.id, result.resendId ?? null, result.ok ? 'sent' : 'failed', result.error ?? null],
    );

    if (result.ok) sent++;
    else failed++;
  }

  // Mark post as posted if at least one recipient succeeded
  if (sent > 0 && post.status !== 'posted') {
    await pool.query(
      `UPDATE posts SET status = 'posted', posted_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  logger.log(`newsletter send complete: ${sent} sent, ${failed} failed`);

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    skipped: sentSet.size,
    total_active: subscribers.length,
  });
}
