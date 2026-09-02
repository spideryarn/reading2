# Review: the cost-eval runner (code, before its first paid run)

Repo: `/home/greg/code/spideryarn2`. You have reviewed this plan twice already
(`docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md`); this is the code
built from it. **Nothing has spent money yet** — the first paid run is gated on a database
migration that has not landed — so this is the last cheap moment to find a design error.

Weight this review higher than the plan-stage ones: a plan review cannot find a runner that
measures the wrong thing.

## What this is for

Measure what one article costs in AI spend — the ingest queue plus every on-demand mode — by
driving fixtures through the **real production pipeline** and reading the `ai_calls` ledger back.
It must not disturb the shared dev database, and its spend must not contaminate the product cost
report.

## What the earlier stages established (all verified, don't re-derive)

- **Attribution.** `runStep` opens its own collector with a literal `scopeKind: "job_step"`, and
  nested collectors *shadow* rather than merge — so wrapping the queue in an eval-scoped
  `collectSpend` records nothing. The design instead wraps each step's `run` in
  `withSpendAttribution({ scopeKind: "eval" }, …)`: `scopeKind` is read at row-write time and
  `withSpendAttribution` re-enters the same box. Since `scripts/ai-cost.ts` defines Product as
  `scopeKind !== "eval"`, **your round-2 acceptance criterion is met with no change to the cost
  machinery** — which was the coordination risk you flagged.
- **Fixture ingress.** `fetchDocument` accepts only HTTP(S) and rejects loopback, so stage 1 is
  replaced through the existing `AdvanceParts.steps` seam by a step that reads committed bytes and
  calls the exported `writeRaw()`. No SSRF guard in `src/` is weakened.
- **The pump trap** (not in the plan; found by the dry pass): `enqueue` ends with `pump()`, which
  drives the job with the **production** registry and wins the claim synchronously — it silently
  bypassed the fixture step on the first attempt. `VERCEL=1` across the `enqueue` call is the
  existing idiom.
- **The baseline** (`evals/cost/baseline/`): ingest + first open is $0.099 on a 2,500-word article
  and $0.61 on a 21,000-word one. A naive sum over the ledger's money columns overstates by 84%;
  totals must go through `totalRows()`. 39 rows are unpriced — unknown, not zero.

## Decisions taken while building, beyond the design

1. **There is no `labels` step.** Labels fan out *inside* `hierarchy`, so label rows carry
   `stepName: "hierarchy"` and `job: "labels"`. The runner therefore reports **two** aggregations,
   by step and by `AiJob`, and `mustPayFor` does not list `labels`.
2. **Cleanup deletes by slug, not by article id** — the id is only known after the job, the slug is
   written down before it, so a draw that crashes mid-job still cleans up. Exact slugs, never a
   `LIKE 'evalcost-%'` prefix, so a concurrent run of this eval is not swept up.
3. **A fatal finding aborts the run** — a scope leak, or a cold step that recorded $0 — rather than
   being printed beside the numbers, because the next draw would spend money measuring the same
   wrong thing. The `finally` still checkpoints, cleans up and summarises.
4. **`--steps`**, so a later stage can run one mode at a time and a free pass can stop short of the
   first paid step. `mustPayFor` is intersected with it.
5. **Hierarchy's effort is read through `structureRequest([])`** rather than restated, because that
   constant is module-private and has already moved once (`fb82dc8`), taking a whole analysis with
   it. Labels' effort has no exported reader; the record says so and names `commit` as what pins
   it. `gitDirty` is recorded too.
6. **`localTarget(store, url)` takes both values** rather than reading them, so every answer can be
   exercised rather than only the one this machine gives.

## What was tested, and what was watched red

40 tests, no database, no network. Mutations that were watched fail, then reverted:

- `totalRows` replaced with a naive `credits + byokUpstream` sum → 5 red.
- `wallClockMs` set to `sum(durationMs)` → the wall-clock-envelope test red (8,000 vs 14,000 ms).
- The cold check's `> 0` changed to `>= 0` → two red.
- `evalScoped` made a pass-through → the eval-arm tests red. The suite permanently carries the dry
  pass's **control arm**: the same stubbed step *without* the overlay records `job_step`, i.e.
  Product spend.
- The local-target allowlist narrowed → the CLI refused with the host named.
- `mustPayFor` made to always demand `hierarchy` on a run that never runs it → `FATAL`, cleanup
  still ran, non-zero exit.

Free end-to-end passes really ran (`--steps fetch,extract,blocks`, ledger redirected to the
test-only file): short-html gave 19 blocks and long-html 186, both matching the measured manifest
exactly; the PDF's 11 MB was written through `writeRaw` with its sha256 verified.

## Known unverified, because the ledger table is unusable right now

`spideryarn.ai_calls` still has `upstream_inference_nanos` while `src/db/schema.ts` says
`byok_upstream_nanos`, so every select and insert on it fails. Therefore: `costStore.forJob()` has
never been exercised against the real table; the attribution round trip has been tested through
`collectSpend` with an injected sink but not through a row that reached the database; the cold
assertions have never fired on real spend; and publication has never succeeded in a free pass
because it needs a tree, and the tree is the paid step.

## What I want from you

1. **Will this measure the right number?** Particularly: the two aggregations (by step and by job),
   the wall-clock envelope, the BYOK totalling, and whether "cold" is actually being established
   rather than assumed.
2. **Is the eval overlay airtight?** It covers calls inside `step.run` and nothing else — a
   postcondition or `session.commit` that bought something would still be `job_step` and land in
   Product. Is the scope-leak check sufficient to notice, and is anything on the ingest path
   already buying outside `step.run`?
3. **Anything that could damage the shared dev database or another agent's work**, in the cleanup
   path especially. This runs where several agents share one Postgres.
4. **What will break on the first paid run** that a free pass cannot reveal? I would rather spend
   your reasoning here than discover it at $0.60 a draw.
5. Anything wrong in decisions 1–6 above.

Rank findings P0/P1/P2. If it is sound, say so briefly rather than inventing findings.

## The code
