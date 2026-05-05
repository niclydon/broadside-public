import { NextResponse } from 'next/server';
import { startJob } from '@/lib/jobs/runner';
import { generateDrafts } from '@/lib/drafts/generate';
import { createLogger } from '@/lib/logger';
import { getSetting } from '@/lib/settings/read';
import { query } from '@/lib/db/pool';
import { z } from 'zod';

const logger = createLogger('api/drafts/generate');

export const dynamic = 'force-dynamic';

const DEFAULT_DAILY_CAP_USD = 5;

const inputSchema = z.object({
  count: z.number().int().min(1).max(20).default(5),
  topic_hint: z.string().max(200).nullable().optional(),
  target_platform: z.enum(['linkedin', 'substack', 'bluesky', 'twitter', 'devto', 'linkedin-article']).nullable().optional(),
  mode: z.enum(['on_demand', 'seed']).default('on_demand'),
  context_limit: z.number().int().min(5).max(200).default(50),
  provider: z.enum(['anthropic', 'openai', 'gemini', 'deepseek', 'grok']).default('anthropic'),
});

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    const txt = await req.text();
    body = txt ? JSON.parse(txt) : {};
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Cost guardrail: refuse if today's spend has already crossed the daily cap.
  const cap = await getSetting<number>('drafts.daily_cost_cap_usd', DEFAULT_DAILY_CAP_USD);
  if (cap > 0) {
    const { rows } = await query<{ today_usd: string }>(
      `SELECT COALESCE(SUM(cost_usd), 0)::text AS today_usd
         FROM draft_generations
        WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`,
    );
    const todayUsd = parseFloat(rows[0]?.today_usd ?? '0');
    if (todayUsd >= cap) {
      logger.log(`draft generation refused: today $${todayUsd.toFixed(4)} >= cap $${cap}`);
      return NextResponse.json(
        {
          error: 'daily draft cost cap reached',
          today_usd: todayUsd,
          cap_usd: cap,
          hint: 'raise drafts.daily_cost_cap_usd setting or wait until tomorrow (UTC)',
        },
        { status: 429 },
      );
    }
  }

  try {
    const jobId = await startJob(
      'generate_drafts',
      parsed.data,
      async (ctx) => {
        return await generateDrafts(
          {
            count: parsed.data.count,
            topicHint: parsed.data.topic_hint ?? null,
            targetPlatform: parsed.data.target_platform ?? null,
            mode: parsed.data.mode,
            contextLimit: parsed.data.context_limit,
            provider: parsed.data.provider,
          },
          ctx,
        );
      },
    );
    return NextResponse.json({ job_id: jobId }, { status: 202 });
  } catch (err) {
    logger.logMinimal('kickoff failed:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
