import { createLogger } from '@/lib/logger';

const logger = createLogger('newsletter');

const RESEND_API = 'https://api.resend.com';

interface SendEmailInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  resendId?: string;
  error?: string;
}

/**
 * Send a single email via Resend. Resend also exposes a batch endpoint
 * (POST /emails/batch) that accepts up to 100 requests per call — for a
 * small subscriber list, one-at-a-time is simpler and gives per-recipient
 * errors without complicating the response shape.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, error: 'RESEND_API_KEY not set' };
  }

  const body: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (input.replyTo) body.reply_to = input.replyTo;

  const stop = logger.time('resend-send');
  try {
    const res = await fetch(`${RESEND_API}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    stop();

    if (!res.ok) {
      const errText = await res.text();
      logger.logMinimal(`resend send to ${input.to} failed: HTTP ${res.status} — ${errText.slice(0, 200)}`);
      return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = await res.json() as { id: string };
    logger.logVerbose(`sent to ${input.to}: ${data.id}`);
    return { ok: true, resendId: data.id };
  } catch (err) {
    stop();
    logger.logMinimal(`resend send to ${input.to} threw:`, (err as Error).message);
    return { ok: false, error: (err as Error).message };
  }
}
