-- 002-showcase-seed.sql
-- Minimal demo seed data for the public Broadside showcase.

INSERT INTO topics (slug, name, description, color, sort_order) VALUES
  ('ai-security',        'AI Security',        'Red-team, jailbreaks, prompt injection, agent safety',      '#5aadf0', 10),
  ('building-in-public', 'Building in Public', 'Shipping, trade-offs, and candid progress updates',         '#7ac0f5', 20),
  ('infra-and-hardware', 'Infra & Hardware',   'Self-hosting, local inference, and systems operations',     '#4ade80', 30),
  ('ai-research',        'AI Research',        'Model capability, evaluation, new techniques, experiments', '#a78bfa', 40),
  ('personal-brand',     'Personal Brand',     'Career, reflection, and high-level industry takes',         '#fbbf24', 50),
  ('travel',             'Travel',             'Trips, places, and observations from the road',             '#f472b6', 60)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO platforms (id, name, max_title_chars, max_body_chars, max_hashtags, supports_media, enabled, notes) VALUES
  ('bluesky', 'Bluesky', NULL, 300, NULL, true, true, '300-char post limit with rich text facets'),
  ('devto', 'Dev.to', 120, NULL, 4, false, true, 'Markdown body via Dev.to API'),
  ('imessage', 'iMessage', NULL, NULL, NULL, true, false, 'Example source-only channel, not a publishing target'),
  ('linkedin', 'LinkedIn', NULL, 3000, 30, true, true, '3000-char hard limit on post body; hashtags counted in body'),
  ('linkedin-article', 'LinkedIn Article', 150, NULL, NULL, true, true, 'Long-form rich text; manual publishing path'),
  ('newsletter', 'Newsletter', 150, NULL, NULL, false, true, 'Email newsletter; subject comes from title'),
  ('substack', 'Substack', 100, NULL, NULL, true, true, '100-char title limit; published via copy-paste'),
  ('twitter', 'X / Twitter', NULL, 280, NULL, true, true, '280-char limit; URLs shortened by t.co')
ON CONFLICT (id) DO NOTHING;

INSERT INTO brands (
  slug, name, tagline, audience_description, accent_color, accent_color_secondary, display_font, pillars, sort_order
) VALUES
  (
    'studio',
    'Studio',
    'Essays, reflections, and product notes',
    'General readers interested in writing, products, and the builder''s point of view',
    '#4a9b8e',
    NULL,
    'Instrument Serif',
    '["essays", "reflections", "product", "meta", "life"]'::jsonb,
    10
  ),
  (
    'lab',
    'Lab',
    'Technical lab for software, infrastructure, and AI workflows',
    'Technical peers following self-hosting, LLM tooling, and system design',
    '#5aadf0',
    NULL,
    'JetBrains Mono',
    '["infra-lab-logs", "llm-engineering", "local-models", "automation", "projects"]'::jsonb,
    20
  ),
  (
    'broadcast',
    'Broadcast',
    'Same systems thinking, different medium',
    'Practitioners and builders who like conversational, personality-forward technical work',
    '#B8593A',
    '#C73E8E',
    'Departure Mono',
    '["episodes", "build-notes", "systems", "voice", "tradeoffs"]'::jsonb,
    30
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO settings (key, value, description, updated_by) VALUES
  (
    'ingest.blacklist_folders',
    '["node_modules", ".venv", ".git", "dist", "build", ".next", "target", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "venv", "env"]'::jsonb,
    'Folder names skipped during project ingestion walk',
    'system'
  ),
  (
    'ingest.max_file_bytes',
    '204800'::jsonb,
    'Max bytes read from any single document during ingestion',
    'system'
  ),
  (
    'ingest.git_commit_limit',
    '200'::jsonb,
    'Number of commits to capture per git repo',
    'system'
  ),
  (
    'ingest.projects_root',
    '"/workspace"'::jsonb,
    'Root directory for project-folder ingestion',
    'system'
  ),
  (
    'ingest.shared-warehouse_enabled',
    'false'::jsonb,
    'Whether to ingest from an optional shared context warehouse',
    'system'
  ),
  (
    'drafts.default_count',
    '5'::jsonb,
    'Default number of draft candidates per request',
    'system'
  ),
  (
    'drafts.daily_cost_cap_usd',
    '5'::jsonb,
    'Daily cost cap for draft generation',
    'system'
  )
ON CONFLICT (key) DO NOTHING;
