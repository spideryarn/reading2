# Verdict

**NO-SHIP.** The core index split is sound, but the migration rollout and claim-time late-commit race can break production behavior. The simultaneous-source repair also has a smaller race that can still create two articles for one address.

## Ranked findings

1. **[Critical — demonstrated bug] The migration is incompatible with the live deployment order.**

   The preflight is an ordinary `SELECT`; it does not prevent an old-code enqueue from committing after the check and before the schema change ([0052_per_article_job_queue.sql](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/drizzle/0052_per_article_job_queue.sql:23>)). Such a row receives `reserves_name=false, url_key=null`, even if it was minting a URL article.

   More importantly, deployment applies migrations before pushing and promoting the new code ([deploy.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/scripts/deploy.ts:1414>)). The parent version of `pg-jobs.ts` does not write either new column. After the migration commits:

   - The old build can continue inserting incorrectly classified active rows.
   - `jobs_active_slug` is already gone.
   - The old claimant has no predecessor check and does not handle `jobs_one_running_per_slug`.
   - If the push or build fails, this incompatible state persists indefinitely, despite the deploy script assuming migrations are additive ([deploy.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/scripts/deploy.ts:1467>)).

   Draining is sufficient only if enqueue traffic stays stopped until the new build is live. Nothing here enforces that. This needs either a real maintenance/quiescence boundary or a two-phase compatible rollout.

   Within the migration transaction, `DROP INDEX` followed by the new indexes is atomic to other sessions, so there is no externally visible indexless window. The non-concurrent DDL will block writes, but table size makes that an operational cost rather than the correctness problem.

2. **[High — demonstrated bug] A late-committing older job gets a `23505`, not `busy`.**

   A concrete interleaving:

   1. A receives the earlier `createdAt` but pauses before its insert commits.
   2. B, with a later timestamp on the same slug, commits and claims.
   3. A commits as queued.
   4. A claims. `hasPredecessor` sees no row whose tuple is older than A, because running B is newer ([pg-jobs.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/pg-jobs.ts:256>)).
   5. A’s update collides with `jobs_one_running_per_slug`. `claimIn` rethrows it ([pg-jobs.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/pg-jobs.ts:322>)).

   The unique index prevents two running jobs, but the claim contract is still broken: the route answers 500 instead of “wait.” The browser retries after errors, so A eventually proceeds after B finishes; the local pump logs the exception and exits ([jobs.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/jobs.ts:997>)), leaving the row dependent on a later browser/pump.

   The existing reverse-claim test inserts every row before any claim, so it cannot expose this ([store-jobs-parity.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/store-jobs-parity.test.ts:689>)).

   `claim` should refuse when either an older active row **or any other running row** exists on the slug. That preserves the deliberately non-FIFO late-commit behavior without using a unique violation as control flow.

3. **[High — demonstrated race] `sourceTaken` drops the source reservation before the adopting row exists.**

   On `sourceTaken`, the loser permanently changes to an unreserved adoption before retrying ([jobs.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/jobs.ts:2115>)). This permits:

   1. Holder H wins `jobs_active_source`.
   2. Loser L receives `sourceTaken`.
   3. H fails or is cancelled before publishing.
   4. A third request C now sees no article and no active source holder, so it mints and reserves a new slug.
   5. L inserts its adopted, non-reserving job on H’s old slug.

   L and C are now active for the same owner and URL on different slugs. L is outside `jobs_active_source`, so both can publish separate articles.

   The loop cannot spin on `sourceTaken`: after adoption it can only be created or match existing work. But it can exit with the duplicate state above. The source claim needs to remain atomic across the repair, or the loser must revalidate before inserting as a non-reserver.

   The advertised simultaneous-URL test does not cover this. It calls `store.enqueueOrGet` directly with preconstructed slugs and merely observes `created/sourceTaken` ([store-jobs-parity.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/store-jobs-parity.test.ts:908>)). It never calls top-level `enqueue`, never executes the repair branch, and never creates an article. It would remain green if that branch were deleted.

4. **[Medium — inferred low-frequency risk] The narrowed ownership rule is not an invariant.**

   The existing-foreign-article attack is correctly refused and tested ([enqueue-owns-the-article.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/enqueue-owns-the-article.test.ts:131>)). However, allowing a slug while it belongs to nobody ([jobs.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/jobs.ts:1988>)) permits this forced interleaving:

   - Bob queues an abandoned, non-reserving job for nonexistent slug X.
   - Alice later mints X for a URL or upload.
   - Alice’s reserver does not conflict with Bob’s non-reserver.
   - If Bob’s row is older, Alice waits behind a row she cannot see or stop.

   Natural occurrence requires guessing or colliding with the random suffix, so the practical likelihood is low. But the plan’s “no other reader can ever come to want this name” is probabilistic, and the narrower rule does not fully land the prior ownership blocker.

5. **[Medium — demonstrated contract gap] Upload recovery is terminal only while the job survives retention.**

   `jobForUpload` correctly searches all statuses by `upload.id` ([routes.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/routes.ts:4318>)), so a retained terminal ingest is found. But finished jobs are trimmed to 50 ([jobs.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/jobs.ts:2425>)). Once that ingest is trimmed, the upload remains claimed but recovery finds no job and returns 409.

   The new test cannot catch either an active-only regression or this retention problem: it deliberately keeps the ingest queued ([uploads-api.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/uploads-api.test.ts:334>)). The prior review’s required “terminal ingest after reload” test did not land.

6. **[Low — demonstrated bug] The filesystem store persists and returns the caller’s status rather than the normalized queued status.**

   It writes the normalized job into memory, but then calls `persist(job)` and returns `structuredClone(job)` ([jobs-fs.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/jobs-fs.ts:398>)). Passing a `running` job therefore produces:

   - queued in memory;
   - running on disk;
   - running in the returned `created` outcome.

   Current production callers already pass queued jobs, so this is not the main feature failure, but it contradicts the store contract and the adjacent comment. Tests only supply queued inputs.

7. **[Low — demonstrated edge bug] The untargeted enqueue conflict catches primary-key collisions that its retry cannot repair.**

   `ON CONFLICT DO NOTHING` catches every unique constraint, including `jobs_pkey` ([pg-jobs.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/pg-jobs.ts:141>)). The re-read classifies only the three queue predicates, so an unrelated existing row with the minted job ID yields `null`. `enqueueOrGet` retries the same ID four times and throws ([pg-jobs.ts](</home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/store/pg-jobs.ts:486>)). It is extremely unlikely, but it is exactly a conflict the retry cannot fix.

## Checks that are sound

- The three re-read classifiers match their partial indexes: owner scope, `reserves_name`, URL scope, and inclusion/exclusion of `cancelling` all agree.
- Reading the job’s timestamp inside the PostgreSQL predecessor statement avoids a real microsecond-rounding fault.
- Filesystem ISO timestamp comparison is chronologically equivalent for `toISOString()` values. The ID tie-break is equivalent only while PostgreSQL’s collation orders the ID alphabet like JavaScript; the schema does not enforce `C` collation, so that remains a portability risk rather than a demonstrated current failure.
- The cancelling blocker landed correctly. The test uses the real claim → Stop → release → successor sequence.
- The late-step test now checks the fingerprint of what the step actually read.
- `useStepJob` chooses the intended running row, otherwise oldest queued row.
- The blocker-specific 409 path appears completely removed. Remaining names are explanatory comments/docs. `HttpError.details` is dormant generic machinery, not an unhandled reachable branch.
- The `running-slot` real-database half meaningfully verifies the new pre-read behavior. The mocked half still proves retry classification, timing, and budget mechanics; it does **not** prove that those four constraints arise from its real inserts or that the look/insert race is handled against PostgreSQL.

Of the four earlier blockers: cancelling is fully landed; ownership and simultaneous-source arbitration are only partially landed for the reasons above; the activation-token blocker belongs to unbuilt stage 2 and is correctly outside this review.

I did not run mutating tests or database probes because this was explicitly a read-only review.