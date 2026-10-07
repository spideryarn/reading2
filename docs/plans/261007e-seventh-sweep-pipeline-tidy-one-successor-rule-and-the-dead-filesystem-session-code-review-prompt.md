# Code review (write-capable): pipeline tidy

You are reviewing, and may fix, one committed stage in this worktree.

**The stage:** on branch `worktree-sweep7-pipeline-tidy`: `db88ac268` (PQ3: one successor rule),
`3b7af38a7` (PQO3: the filesystem session deleted), `99dcc2030` (PQO6: two tests seen red, and a
Messages continuation-boundary test written), `d5384af8e` (Summary's stamp written into
`docs/project/summaries.md`), `3d8b15c01` (merge of `origin/dev`), `285acf8c7` (plan renamed). Read
each with `git show`. The plan:
`docs/plans/261007e-seventh-sweep-pipeline-tidy-one-successor-rule-and-the-dead-filesystem-session.md`.
The umbrella: `docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md`, cluster C8 and § What
the review changed (U6, U7, U10, U18). The findings:
`docs/investigations/261006d-seventh-sweep-depth-pipeline-*` (PQ3 is from your family's read; PQO3
and PQO6 from Opus's), with both cross-reviews.

**Try to break each item.**

1. **PQ3.** A live Labels failure used to mark the base `failed` while a successor job that would
   still carry the work was queued; a lease expiry in the same position left it `pending`. Both
   now ask one helper, `anotherJobCarriesLabelsIn(exec, { slug, ownerId }, excluding)` in
   `src/store/pg-jobs.ts`, called from `settleIn` in `src/store/pg-session.ts` and from the sweep.
   U10 named the broken twin: the helper must exclude the settling job, keep the owner scope, and
   the live path must keep its `unfinished === "labels"` and `error`-only trigger. Check all three
   in the code. Then: is the helper's answer read inside the same transaction and under the same
   locks as the write it decides (can a successor be enqueued, or finish, between the question and
   the write, so that the base is left `pending` with nobody coming — a stuck "pending" is worse
   than a wrong "failed")? The builder says the `not(cancelling)` clause is covered by no test: is
   the clause right (a successor that is being cancelled will not carry the work)? One cost stated:
   the sweep runs one query per ended labels job instead of one per sweep; is that bounded?
2. **PQO3: a deletion.** `fsStoreSession`, `JobSettles`, `readsOf`, `LEGACY_UNCONVERTED_STEPS` and
   its types, the conditional return type on `PipelineStep.run` (now `ConvertedProduct`),
   `checkProduct`'s third parameter (the no-`parts` refusal is now unconditional), and
   `tests/store-session.test.ts` (18 cases: 10 said to have a Postgres twin, 3 obsolete, 5 ported).
   **Every "unused" is an absence: re-run the greps yourself** over `src`, `scripts`, `evals`,
   `tests`, `package.json`, and for string-built names. **A code comment argued against part of
   this deletion**: the docstring on `LEGACY_UNCONVERTED_STEPS` said "Deleting it would be the
   wrong tidy-up … an absent one is no rule at all." The builder deleted it because the refusal it
   protected is now unconditional in both the type and `checkProduct`. Judge that: was the empty
   list the thing that made a future unconverted step a compile error or a test failure, and is
   that protection really still there without it? Then check the twins: for each of the ten cases
   said to have a Postgres twin (the plan's table names them), open the named twin and confirm it
   asserts the same rule, not merely the same vocabulary. Name any case whose rule now has no test.
   `JobStore.finish` and `releaseStep` must be untouched (U7).
3. **PQO6.** The Messages continuation-boundary test (`tests/messages-stream.test.ts`, "a Stop as
   the backoff finishes leaves one row, and opens no attempt 2") wraps only the timer whose length
   is a first backoff and asserts it saw exactly one. Is that a robust way to pick the timer, or
   will a change to the backoff schedule or the SDK's own timers make it pass vacuously or fail
   for the wrong reason? Could it pass against an implementation that opens attempt 2 and then
   aborts it?
4. **Summary's stamp (docs only).** `docs/project/summaries.md` now says Summary is the one step
   whose stored output a prompt-version bump does not make eligible for an unforced rewrite, with a
   table separating "shown as outdated" from "eligible for an unforced rewrite", and quotes the code
   comment on `STEPS.simple.stamp`. Check every sentence against `src/pipeline.ts` and
   `src/store/pg.ts`. It attributes the choice to the code's comment and an earlier review, not to
   the owner: confirm no new attribution to him was introduced, and that his existing quoted
   write-once rule (2026-10-04) is quoted exactly as it was.
5. Every rewritten comment and doc sentence in the stage is a claim; check each against the code
   (the corrections in `session.ts`, `pg-session.ts`, `pg-jobs.ts`, `jobs.ts`, `structure.ts`,
   `sketch.ts`, `checkpoints.ts`, `artifacts-pg.ts`, `ingest-queue.md`, `database.md`,
   `structure-step.md`, and the dated notes added to the two postmortems).

Postgres-backed tests cannot run in your sandbox (no network, not even loopback): do not report
them as failing; say which could pass against a plausible wrong implementation. Pure tests you can
run: `npx vitest run tests/check-product.test.ts`, `tests/messages-stream.test.ts`,
`tests/ai-call-transport-retry.test.ts`. No `npm test`.

**Fix what is inside this stage**, narrowly, red-first where a red is possible; write any Postgres
test and mark it unrun. **Report, do not fix, anything wider.** Do not touch `src/db/schema.ts`,
`drizzle/`, the step budgets, what Stop does, `src/routes.ts`, anything under `src/web/`. No new
reader-facing sentence. Do not commit. Do not attribute any decision to the product owner in docs.

**Reply format.** Findings C1, C2, …; P0 (an import lost or a broken article published) / P1 (a
reader sees wrong behaviour, or a rule lost its only test) / P2 / P3; the input; reproduced or
reasoned; fixed or not (and the test, run or unrun). Then files changed, what you ran with raw
counts, a verdict (ship / ship with these fixes applied / do not ship), and wider notes.
