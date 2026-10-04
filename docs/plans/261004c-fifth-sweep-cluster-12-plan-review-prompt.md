# Review: a plan for five small model-call plumbing cleanups, before it is built

You are reviewing a plan before it is built. Read-only: do not edit any file.

Repo: this worktree, branch `worktree-sweep5-c12-model-call-plumbing` (TypeScript, ESM). Base
`origin/dev` at `6f7aadb85`.

## The candidate

Live pre-commit: one untracked file,
`docs/plans/261004c-fifth-sweep-cluster-12-model-call-plumbing.md`. Nothing else has changed.

Read the plan, then the code it changes: `src/ai-call.ts` (`ProviderRefused`, `retryAfterMs`,
`apiKey`, `prepare`, `refuse`, `openRouterStream`, `openRouterJson`, `openRouterImage`, and the other
`!response.ok` sites), `src/fetch.ts` (`retryAfterMs`, `retryDelayMs`, `readBody`), the callers of
both parsers (`src/structure-deepen.ts`, `src/embeddings.ts` § `backoffMs`, `src/concurrency.ts` §
`refused`, `src/bibliographic.ts`, `src/link-previews.ts`, `src/pdf-read.ts`), the seven runners
named under R3 plus `src/transcribe.ts` and `src/embeddings.ts` § `apiKeyFromEnv`, `src/env.ts`,
`src/db/client.ts`, `src/messages.ts` § `CODE_KINDS`, the two `*_UNUSABLE` constants and their
tests, and `src/models.ts` § `effortFor`.

The evidence the plan rests on is in
`docs/investigations/261003b-fifth-sweep-server-request-layer.md` (R2, R3, R6) and your own earlier
review of it, `docs/investigations/261003b-fifth-sweep-review-sol-on-server-and-web.md`.

## What it is meant to do

Delete duplication without changing what a reader gets, except in two named places: the unified
`[ai-unusable]` sentence, and a `Retry-After` of zero or in the past becoming `null` for the three
`fetch.ts` callers.

## What I want from you

Independent pass first. For each of the five items: is the fix right, is anything it would break
unnamed, is the red-first test one that would actually be red today and green after, and is any
proposed piece of machinery (the leaf module, the census test, `pipelineEffortOverride`) not worth
its keep?

Severity: P0 data loss, security, wrong charging, service unusable · P1 user-visible wrong
behaviour or an authoritative contract violated · P2 design or maintainability risk · P3 prose.
Mark each finding *established* (direct evidence) or *reasoned*. Give each an ID, F1, F2, ….

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. R3: does any of the seven runners' `catch` blocks rewrite an error thrown from inside the
   gateway call, so that `NOT_CONFIGURED` would arrive as a different sentence once the pre-check is
   gone? Does anything between the old pre-check and the gateway call do work, or log, that should
   not happen with no key?
2. R3: which entry points under `scripts/`, `evals/`, `tools/` reach these nine modules without
   loading `.env.local` at their own edge and without importing `src/db/client.ts`?
3. R2: is "not positive is null" the right policy for `fetch.ts`'s callers, or does the bibliographic
   cooldown (60 s default against 1 s) make that a regression worth avoiding? Is requiring a date to
   start with a letter sound against the three HTTP-date forms?
4. F11: is metering `usage` from a non-2xx body safe against double counting (the meter's `saw` on
   the streaming seam), and is the body of a refused streaming call ever large or not JSON in a way
   that matters?
5. R6: is the unified sentence true of both discard paths?
6. X13a: is throwing on an invalid value right, given that `effortFor` runs inside production
   request paths where the variable is unset?

End with a line `VERDICT: build as planned` or `VERDICT: change first`, followed by the changes.
