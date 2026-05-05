# Langfuse In Broadside

Broadside uses Langfuse as an optional tracing layer for LLM calls.

## What It Is Used For

- Compare provider behavior across draft-generation and review flows
- Record token usage and estimated cost
- Inspect structured outputs during prompt iteration
- Debug failures without reading raw application logs

## Where It Is Used

- `src/lib/drafts/generate.ts`
- `src/lib/review/evaluate.ts`
- `src/lib/tracing/langfuse.ts`

If Langfuse keys are not configured, tracing is disabled and the app still
runs.

## Deployment Boundary

One reasonable deployment pattern is to self-host Broadside and Langfuse inside
the same trusted environment so traces do not leave that boundary during normal
operation.

That reduces third-party egress risk, but it does not remove retention risk.
Prompt and output data may still persist inside the tracing system.

## What Gets Traced

For the traced draft-generation and review calls, Broadside records:

- Trace name and provider
- Model name
- System prompt and user message sent to the provider
- Structured output returned by the provider
- Token counts
- Estimated cost metadata
- Error status when a provider call fails

## Why The Public Repo Shows This

This repository is a teaching and architecture showcase. The Langfuse
integration is included so readers can see one practical pattern for
instrumenting prompt-driven application flows.

## Privacy Boundary

Langfuse is useful, but it is also a data egress surface. In a real deployment,
you should make an explicit decision about what prompt and output content is
allowed to leave the app.

For sensitive deployments, common options are:

- Disable tracing entirely
- Self-host Langfuse on the same host or inside the same trusted network boundary
- Redact prompt and output payloads before tracing
- Trace only metadata such as provider, model, latency, tokens, and cost

One more caveat: if you ingest Langfuse-derived metadata into a downstream
warehouse or analytics pipeline, your privacy boundary extends to that second
storage location too. Self-hosting Langfuse helps, but it is not the whole
story once traces are mirrored elsewhere.

This public repo documents the current approach; it does not prescribe that
you should send all prompt content to a third-party service or retain it
indefinitely.
