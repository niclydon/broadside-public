// Gemini 2.5 Pro drafting client using the REST generateContent endpoint
// directly — avoids pulling in a heavy SDK. Structured output via response_schema.

import { createLogger } from '@/lib/logger';

const logger = createLogger('gemini');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DRAFTING_MODEL = 'gemini-2.5-pro';

export interface GeminiToolResult<T> {
  parsed: T;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  cost_usd: number;
}

/**
 * Gemini 2.5 Pro pricing (as of the knowledge cutoff):
 *   input  $1.25 / MTok (prompts <=200K tokens)
 *   output $10.00 / MTok
 */
function computeCost(usage: { input_tokens: number; output_tokens: number }): number {
  const IN = 1.25 / 1_000_000;
  const OUT = 10 / 1_000_000;
  return usage.input_tokens * IN + usage.output_tokens * OUT;
}

function sanitizeSchemaForGemini<T extends Record<string, unknown>>(schema: T): T {
  // Gemini's response_schema uses a subset of OpenAPI 3.0 schema — strip
  // fields it doesn't support (additionalProperties, $schema, etc.).
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeSchemaForGemini(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === 'object' && item !== null
          ? sanitizeSchemaForGemini(item as Record<string, unknown>)
          : item,
      );
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export async function callGeminiWithSchema<T>(opts: {
  systemPrompt: string;
  userMessage: string;
  // biome-ignore lint/suspicious/noExplicitAny: JSON Schema is unconstrained
  schema: any;
  temperature?: number;
  maxTokens?: number;
}): Promise<GeminiToolResult<T>> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GEMINI_API_KEY not set');

  const {
    systemPrompt,
    userMessage,
    schema,
    temperature = 0.8,
    maxTokens = 8000,
  } = opts;

  const stop = logger.time('gemini-2.5-pro');
  try {
    const url = `${BASE_URL}/models/${DRAFTING_MODEL}:generateContent?key=${apiKey}`;
    const body = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        responseSchema: sanitizeSchemaForGemini(schema),
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`gemini HTTP ${res.status}: ${errText.slice(0, 400)}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    stop();

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) {
      throw new Error(
        `gemini returned no text. finishReason=${data.candidates?.[0]?.finishReason}`,
      );
    }

    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch (err) {
      throw new Error(`gemini returned invalid JSON: ${(err as Error).message}`);
    }

    const usage = {
      input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
    const cost = computeCost(usage);
    logger.log(
      `gemini done: in=${usage.input_tokens} out=${usage.output_tokens} cost=$${cost.toFixed(4)}`,
    );

    return { parsed, usage, cost_usd: cost };
  } catch (err) {
    stop();
    logger.logMinimal('gemini error:', (err as Error).message);
    throw err;
  }
}
