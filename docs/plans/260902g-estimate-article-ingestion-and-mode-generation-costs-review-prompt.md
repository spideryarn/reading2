# Review request: plan for a per-article cost eval

You are reviewing a **plan** (nothing is implemented yet) in the Spideryarn repo. The plan:

`docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md`

Goal of the plan: measure what one article costs in AI spend — full ingestion queue plus every
AI-powered reading mode — across three representative fixtures (short HTML, long/dense HTML,
~20-page PDF), built as a repeatable eval that reads the existing `ai_calls` spend ledger back by
`runId`, with model-comparison arms later. Real paid runs, not a dry-run token estimator (the
user chose this explicitly). The plan must stay read-only towards the cost-tracking machinery,
which other agents are actively working on.

## Evidence to read, not just the prose

- The plan doc itself, including its appendix (preliminary range, cost-reduction candidates).
- The ledger machinery it depends on: `src/ai-spend.ts` (collectSpend, ScopeKind), sink
  `src/store/ai-calls.ts`, schema `src/db/schema.ts` (ai_calls table), report `scripts/ai-cost.ts`.
- Real spend data the priors came from: `data/_ai-calls.jsonl` (565 rows; note the
  `towards-a-theory-of-bugs` hierarchy jobs — 11 paid calls, $5.43, all `outcome: "ok"`, output
  pinned at max_tokens).
- The pipeline it will drive: `src/pipeline.ts` (`STEP_ORDER`, `DEFAULT_INGEST_STEPS`, step
  implementations), `src/token-budget.ts`, `src/models.ts` (`MODEL_ENV_VAR`, `STAGE_EFFORT`),
  `src/pdf-read.ts` (chunking + per-chunk cache).
- The harness it will copy: `evals/hierarchy-structure/` (run.ts, model-arms.ts, corpus.ts),
  `evals/declared-spend.ts`, `evals/README.md` (evals are excluded from `npm run cost`),
  `tests/no-undeclared-spend.test.ts`.
- Context docs: `docs/project/ai-gateway.md` (esp. the duration-measurement trap),
  `docs/project/prompt-caching.md`, `docs/postmortems/260826a-toc-max-tokens.md`,
  `docs/plans/260831ah-toc-on-request-and-the-tree-that-costs-nothing.md` (a STOPPED plan
  touching hierarchy cost), `docs/research/260827d-ai-cost-tracking-options.md`.

## What I want from you

1. **Holes and wrong assumptions.** Anything the plan asserts about the codebase that the code
   contradicts. Check especially: can the eval actually drive pipeline steps in-process with
   `force` and a `collectSpend` eval scope, or is there a coupling (job queue, articles row,
   store mode) that breaks that? Does the `runId`/`scopeKind` readback work the way the plan
   assumes in postgres mode as well as files mode?
2. **Methodology.** Is "cold cost is the number" right, and are the cache-defeating steps
   sufficient (articleFingerprint force, PDF chunk cache, prompt-cache TTL between eval steps)?
   Is the per-article vs per-interaction split sound? Anything that would make run-to-run
   numbers incomparable (adaptive thinking variance, retries, OpenRouter routing)?
3. **The truncation tail.** The plan treats hierarchy retry-on-truncation as the dominant cost
   and proposes to measure it by letting it happen once. Is that the right way to characterise a
   tail — or does it need repeated runs / a variance treatment the plan lacks?
4. **Scope and staging.** Is anything in the wrong order, or missing a stage (e.g. asserting the
   eval itself doesn't corrupt shared dev state, given several agents share the tree and the
   local database)? Is anything over-built for an alpha where speed wins?
5. **The cost-reduction candidates.** Any you'd re-rank, any tradeoff mis-stated, any option
   missing.
6. **The preliminary range table.** Given the ledger data, are the priors defensible?

Be specific: name files and lines. Rank findings by severity (blocker / should-fix / nit). End
with a clear verdict: approve as-is, approve with changes (list them), or rework.
