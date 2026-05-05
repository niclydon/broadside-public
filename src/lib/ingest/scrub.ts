// Scrub likely-secret tokens from ingested text before persisting.
// This is a best-effort sanitiser — not a guarantee — but captures the
// common shapes (Anthropic, OpenAI, GitHub, AWS, Stripe, Slack, generic JWTs).

const PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'anthropic', regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  { name: 'openai',    regex: /sk-proj-[a-zA-Z0-9_-]{20,}/g },
  { name: 'openai',    regex: /sk-[a-zA-Z0-9]{30,}/g },
  { name: 'github-pat',regex: /github_pat_[a-zA-Z0-9_]{30,}/g },
  { name: 'github',    regex: /gh[oprsu]_[a-zA-Z0-9]{20,}/g },
  { name: 'aws',       regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'aws-sec',   regex: /(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/g }, // careful — can false-positive
  { name: 'stripe',    regex: /sk_(?:test|live)_[a-zA-Z0-9]{24,}/g },
  { name: 'slack',     regex: /xox[baprs]-[a-zA-Z0-9-]{10,}/g },
  { name: 'jwt',       regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
  { name: 'pat',       regex: /(?:api[_-]?key|secret|token|password)[=:][ "']?([a-zA-Z0-9_-]{20,})/gi },
];

// AWS secret is too noisy — it matches many base64 blobs. Skip it by default.
const HIGH_PRECISION_ONLY = new Set(['aws-sec']);

export interface ScrubResult {
  text: string;
  redacted: number;
}

export function scrubSecrets(input: string): ScrubResult {
  let out = input;
  let count = 0;
  for (const { name, regex } of PATTERNS) {
    if (HIGH_PRECISION_ONLY.has(name)) continue;
    out = out.replace(regex, () => {
      count += 1;
      return `[redacted:${name}]`;
    });
  }
  return { text: out, redacted: count };
}
