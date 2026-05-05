# Broadside

Broadside is a multi-brand editorial desk and AI drafting app for turning
project work, local notes, and external signals into platform-specific writing.

This repository is a sanitized public showcase of a private system. It is meant
to show the product shape, schema, prompt strategy, and app structure without
shipping any operator identity, internal infrastructure details, or live
credentials.

## Public Showcase Safety

- Treat this repo as a code and architecture reference, not a production-ready
  deployment.
- The app refuses normal requests unless `BROADSIDE_SHOWCASE_DEMO=true` is set.
- Example brands, handles, hosts, and environment variables are placeholders.
- Private operational scripts, local memory artifacts, and personalized voice
  training sources are intentionally excluded.

## What It Demonstrates

- Multi-brand content groups and platform variants
- AI-assisted draft generation and review
- Brand asset management and campaign organization
- Editorial guidance for hooks, headlines, and platform fit
- A Next.js + Postgres application structure for publishing workflows

## Quick Start

```bash
npm install
npm run dev
```

Optional scripts:

- `npm run build`
- `npm run typecheck`
- `npm run migrate`

## Notes

- Some integrations are intentionally demo-oriented or incomplete in this
  public cut.
- You should expect to supply your own environment variables, storage, OAuth
  apps, and publishing credentials before adapting the project for real use.
- Langfuse usage is documented in `docs/LANGFUSE.md`.
- The public repo uses squashed showcase migrations instead of the full private
  development migration history.
