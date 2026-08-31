# Review: the transactional stage runner

You are reviewing a plan before it is built, in the repo you have access to. Read the code; do not
take the plan's claims on trust. Where the plan asserts a fact about the tree, check it.

## What to read

- `docs/plans/260827j-transactional-stage-runner.md` — the plan under review
- `docs/plans/260827h-durable-queue-and-uploads.md` — the queue/upload half. § 7 is the A/B question whose
  answer this plan implements; § 8 is the wiring this plan says goes first
- `docs/plans/260827h-durable-queue-and-uploads-review-sol.md` — your own earlier review, whose ordering this
  plan follows in every place but one
- `src/store/artifacts.ts`, `src/store/artifacts-fs.ts` — the seam and its only implementation
- `src/store/revisions.ts`, `src/store/pg-revisions.ts` — the revision lifecycle and its fence
- `src/store/jobs.ts`, `src/store/pg-jobs.ts`, `src/store/jobs-fs.ts` — the job store, built and
  tested, not yet wired
- `src/jobs.ts` (`runStep`, `advanceJob`, `runJob`), `src/pipeline.ts` (`STEPS`, `stepIsDone`,
  `assertProduced`, `acquireUpload`)
- `src/db/schema.ts` — `article_revisions`, `revision_blocks`, `revision_step_runs`, `jobs`
- `src/db/client.ts` — the pool, and the transaction-pooler constraints in its header

## What I want

Be adversarial. I would rather find this wrong now than after nine stage modules have moved.

1. **Is the ordering reversal justified?** The plan puts the job wiring before the artefact store,
   against your earlier item 1, on the grounds that `fenceJob` updates `spideryarn.jobs` on
   `attempt_id` and so cannot fence anything until a job row exists there. Check that claim. If it is
   right, is the conclusion right?
2. **Is the four-landing decomposition actually independent?** For each of A, B, C, D: is the tree
   really working after it, and is the "true afterwards / still false" statement honest? Name any
   landing that cannot stand alone.
3. **The `run` signature change.** Stages return `{detail, parts, stamp}` and the runner writes.
   Is returning better than a transaction-scoped store on `ctx`, for the reason given? What does
   returning cost that the plan has not said — memory for `raw_bytes` and a 32 MiB HTML held across
   a transaction, streaming, progress reporting, partial results on failure?
4. **The transaction boundary.** Artefacts + `revision_step_runs` + the job transition in one
   transaction, with the stage running *outside* it. Is that right? What is the longest thing inside
   the transaction, and does it hold a row lock while a model call is in flight anywhere?
5. **`blocks` as a table.** Delete-and-insert per revision, `has` must not see a previous
   generation. Is there a case the plan has missed — `block_identities`, the composite FK, the
   generated `fts` column, ordinals?
6. **What the plan has not noticed at all.** This is the most valuable finding. The last two reviews
   each turned up a dependency nobody had written down. Look for a third.
7. **The upload settle moving into the artefact transaction.** Both are Postgres, so it is
   available — but is it correct? What about the filesystem adapter, where it is not?

For each finding: severity (critical / high / major / minor), the evidence with `file:line`, a
concrete reproduction, and your confidence. End with SHIP or NO-SHIP and, if NO-SHIP, the order to
build in instead.
