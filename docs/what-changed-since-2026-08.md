# Where the private system is now

*Summary written October 18, 2026, from the private repository's commit
record since the August 1, 2026 snapshot (56 commits, snapshot version
0.5.14 to private version 0.5.50). Prose only: none of this code is in the
public tree, and the operational detail behind it stays private.*

## Publishing reliability became the main event

The summer's work was dominated by making unattended publishing boring:
per-post locks and claim-before-publish semantics so a scheduler and a
human can never double-post; advisory-lock discipline with bounded
timeouts; every platform HTTP call bounded; wedged publishes made loud
instead of silent; health endpoints gated on the real checks, including
posts stranded in a "publishing" state. A run of adversarial reviews drove
several of these fixes, which is recorded because it changed how the
system is worked on, not just what it does.

## Model routing grew governance

Drafting models are now addressed by role aliases rather than pinned model
names, with configuration checks that fail loudly when a role is pointed at
a retired model (one retired slug kept drafting for weeks before anyone
noticed, which is the kind of failure the checks exist to catch). Two local
models resolve through the same alias layer as the hosted providers.

## New capabilities

- Public dev.to articles can be ingested as drafting context.
- An aesthetic-resolution library is dual-run against the legacy path
  before it takes over.
- Characters from a companion fiction-tracking app can be bound to
  editorial assets, so generated writing keeps its cast straight.

## What did not change

The product shape in this snapshot, the multi-brand desk, the platform
variant model, the review workflow, is still the system. The private work
since August hardened the machinery underneath it rather than replacing
it.
