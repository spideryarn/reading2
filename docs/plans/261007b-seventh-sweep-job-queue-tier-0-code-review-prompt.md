# Code review (write-capable): the job queue's Tier 0 defects

You are reviewing, and may fix, one committed stage in this worktree.

**The stage:** five commits on branch `worktree-sweep7-jobs-tier0`: `7d3a4b4d9` (PQ1), `079597a33`
(PQO1, the deadline row), `1251714ec` (PQ2), `3908e84f3` (PQO2), `db08f2408` (PQ4 + PQO4, comments
only). `0063c8ddb` is a merge of `origin/dev`; `6ce96466b` renames the plan. Read each with
`git show`. The plan: `docs/plans/261007b-seventh-sweep-job-queue-tier-0.md`. The umbrella:
`docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md`, cluster C3 and § What the review
changed (U1, U8, U16 are binding). The findings: `docs/investigations/261006d-seventh-sweep-depth-pipeline-*`
(PQ1, PQ2, PQ4 are from your family's read; PQO1, PQO2, PQO4 from Opus's), with both cross-reviews.

**This is the import queue: a mistake here strands a reader's import or publishes a broken
article.** Try to break each item rather than confirm it.

1. **PQ1.** A failed freshness read is now caught inside `runStep`'s `try` and ends the job
   `error`, retryable. And — **the builder's own divergence from both reviews** — `walkClaim`'s
   `note()` (a progress write) now logs a warning and carries on for any failure except
   `StaleAttemptError`, instead of ending the job. The builder's reasons: ending it needs a new
   reader-facing sentence and throws away paid work over a progress bar; the cost is that a Stop
   pressed on another server is noticed one step later. **Judge that trade directly.** Can a
   swallowed `note()` failure hide a lost claim, a cancelled job, or a database that is down, so
   that a step runs and spends that should not have? Can it loop? Is `StaleAttemptError` the only
   failure that must stop the walk (what about a cancellation signal carried by the same write)?
   The builder left `store.pauseForDeadline` and three mid-walk `endJob` calls to the lease: is
   that right?
2. **PQO1, the deadline row.** On our own deadline the step's returned product must NOT be
   committed (`assets` can return an incomplete manifest stamped current); earlier steps' work
   stays; the walk goes through the existing `pauseForDeadline` with all four of its answers
   (paused, cancelled, stale claim, exhausted budget). Check each of the four. Find an input where
   the late product is committed anyway, or where a job loops pause → resume → deadline for ever
   (what bounds it?). The two Stop characterisation tests pin today's behaviour on purpose (an open
   product question): confirm the stage did not change Stop.
3. **PQ2.** With the queue lock held, a job that does not exist now answers `null` → 404. With the
   lock held and a job that DOES exist, it must still answer busy with the job. Any caller that
   treats `null` differently from the old object?
4. **PQO2.** The title is persisted through `noteProgress` (no migration; `jobs.title` existed) and
   lifted from `metadata` as well as `extract`. Can a later write blank a title already stored
   (an `undefined` or `""` overwriting it)? Is the store contract change reflected in every
   implementation and fake (`grep -rn "noteProgress" src tests`)?
5. **Comments (55 edits).** Each rewritten comment is a claim. Check EVERY one against the code,
   not a sample (the sixth sweep found a third of rewritten comments false on review). The builder
   says compiled output is identical with comments stripped: confirm no code line changed in
   `db08f2408` (an AST or comment-stripped comparison). The builder flags two budgets as probably
   wrong and changed neither (`STEP_BUDGET_MS.assets` 185 s against about 360 s real; `fetch` 150 s
   against multi-candidate paper sources): report your view, do not change a number.

The new tests are in `tests/jobs-walk.test.ts` § "the exits of a claim" and need Postgres, which you
do not have (no network, not even loopback): **do not report them as failing; reason about whether
each could pass against a plausible WRONG implementation**, and say which. You may run tests that
need nothing outside the tree (`npx vitest run tests/<file>`) and `node --import tsx <script>`. No
`npm test`.

**Fix what is inside this stage**, narrowly; for anything needing Postgres to prove, write the
test and say it is unrun, so the orchestrator runs it. **Report, do not fix, anything wider.** Do
not touch `src/routes.ts`, `src/store/pg-session.ts`, `src/db/schema.ts`, `drizzle/`. Do not
commit. No new reader-facing sentence. Do not attribute any decision to the product owner in docs:
the choices here were the orchestrator's (Claude's) and the builder's.

**Reply format.** Findings C1, C2, …; severity P0 (an import lost, a broken article published, a
double spend) / P1 (a reader sees wrong behaviour) / P2 (correctness, not visible) / P3. For each:
the input, reproduced or reasoned, fixed or not (and the test, run or unrun). Then: files changed;
what you ran, raw counts; verdict (ship / ship with these fixes applied / do not ship); wider notes.
