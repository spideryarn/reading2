# Route the cheap-model metadata spike through the gateway

**Status**: built, 2026-10-01.

## Why

`tests/no-undeclared-spend.test.ts` went red on dev with 20abc3379: the second metadata spike of
[261001m](261001m-bulk-import-of-many-papers-a-stepping-stone.md),
`evals/pdf/minimal-metadata/cheap-model-spike.mts`, read `OPENROUTER_API_KEY` out of `.env.local`
by hand and `fetch`ed `openrouter.ai/api/v1/chat/completions` directly, so its spend reached no
ledger. The red blocks deploys.

## What we're doing

Send the call through the seam: `openRouterJson("eval", …)` from `src/ai-call.ts`, inside
`withLedger("eval", …)`, with `loadEnvLocal()` at the script's edge — the shape of
`evals/extraction/tidy.mts` and `evals/shelf-topics/run-arms.ts`. Same model, same prompt, same
6,000-character cap, same `response_format: json_object`, and the literal model id rather than the
quick-tier alias. The script's own `usage.cost` total goes: `withLedger` prints the run's total from
its collector, which counts a BYOK call by its upstream figure. A running local database is needed
for the row to be written down; a failed write is only logged, not fatal.

**The one experiment setting that changes: reasoning effort.** The spike asked for `reasoning:
{effort: "low"}`. The seam owns effort per job (`CHAT_REASONING`), and the `eval` row is
`providerDefault`, so `outgoing()` strips any `reasoning` a caller sends. Through the seam the spike
runs at the provider's default effort for Luna. The figures in 261001m were measured at `low` by
the raw version (20abc3379), and they stay as they are — it says so there. A re-run would be a new
measurement, probably with more reasoning tokens and so a higher cost.

The wire's routing behaviour changes too: the `eval` seam adds `require_parameters: true` and
`allow_fallbacks: false`. That can refuse a call the raw default route would have retried or sent to
an upstream that did not support every parameter. It does not change the named model, prompt or
response format; it is the eval route's existing rule for keeping a measurement attributable.

## What we passed over, and why

- **A declared, metered bypass** (`DECLARATIONS` entry plus `declaredFetch`), which would keep
  `effort: low` — the precedent is `hierarchy-structure-chat`, whose arms vary effort. Passed over
  for two reasons. Greg's guidance for this fix was the seam unless the raw transport is what is
  being measured, and it is not: the transport is incidental. And the declared path's
  `observe.openRouter` reads only `usage.cost`. 261001m records that this key is BYOK for Luna and
  answers `cost: 0` with the real figure in `cost_details.upstream_inference_cost`. A declared row
  would therefore say **$0, settled by the provider** — a zero in the direction that looks like
  success. The seam's `Meter` reads `is_byok` and the upstream figure, so its row is right.
  (That gap in the declared observer is pre-existing and wider than this spike; it is not fixed
  here.)
- **Filing it under a product job that already asks for `low`** (`simple-check`, `link-summary`).
  That would put eval money into a product job's total, which is the thing `tidy.mts` warns against.
- **Letting `eval` callers choose their own effort.** A seam change for every eval, to keep a spike
  that has already been run byte-for-byte reproducible. Not worth it today; when bulk import gets a
  real metadata job, that job's `CHAT_REASONING` row is where `low` belongs.

## Review

GPT Sol on the plan ([261001o-plan-review-sol.md](261001o-plan-review-sol.md)): no P0/P1, and it
confirmed both claims above from the code. Its P2 (this paragraph's wording, the database
prerequisite) and P3 (the literal model id) are applied.

## Checks

The guard goes red → green on this file; `npm run typecheck`; the spend tests. The spike is not run
for real (it costs money, and its results are already recorded).
