# Snapshot Provenance

## What this repository is

`broadside-public` is the public snapshot edition of Broadside, a private
multi-brand editorial and AI drafting system: a publishing desk that turns
project work, notes, and external signals into platform-specific writing
(dev.to, Substack, a personal blog, Bluesky, and others).

It exists so the architecture, schema, and prompt strategy can be read
without exposing the working system.

## Edition facts

- Code snapshot date: **August 1, 2026** (public cut version 0.5.14)
- Documentation refresh: **October 18, 2026**
- Private system at refresh time: version 0.5.50, last committed
  September 14, 2026; 56 private commits since the snapshot date
- License: MIT (added in the October 2026 refresh; the repository was
  previously published without a license file)

## What was excluded, and the scrub standard

The private repository's working material does not cross over: production
content and drafts, publishing history, engagement data, evaluation outputs,
deployment units, operator runbooks, and the narrative project logs the
system itself ingests. As with the initial public release:

- Personal names, hostnames, domains, filesystem paths, and
  operator-specific deployment notes were removed or generalized.
- Private workspace adapters, planning notes, memory artifacts, and
  operational scripts were excluded.
- Demo defaults and example brands replace private production identities.
- Migrations are squashed showcase migrations, not the private history.

## Refresh policy

This edition is refreshed deliberately, not mirrored. The private system's
day-to-day work (operational reliability, deployment detail, live content
operations) accumulates faster than a public scrub can responsibly follow,
so refreshes re-verify the tree, update the provenance and the
what-changed summary, and say plainly what the snapshot does and does not
represent.
