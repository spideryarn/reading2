# Verdict: NO-SHIP

The minted-draft guard works, but item 4 still admits the exact race it claims to prevent. There are also two failure-handling and cost holes not covered by the tests.

## Findings

1. **Critical — reopened drafts can still overwrite a revision they were not copied from.**

   [`draftBaseOf`](/home/greg/code/spideryarn2/src/store/pg-session.ts:196) assigns a reopened R1-based draft whatever revision is current when it runs:

   1. D is minted from R1.
   2. The claim hands D back.
   3. R2 publishes.
   4. The next claim reopens D and records R2 as its `base`.
   5. Publication sees `previousRevisionId === R2`, so [`refuseIfBaseMoved`](/home/greg/code/spideryarn2/src/store/pg-session.ts:221) passes.
   6. D, still copied from R1, buries R2.

   That is the named race, not merely a weaker adjacent guarantee. Furthermore, the SELECT is outside `openOrBeginJobDraft`’s locked transaction, so a publication between reopen and that SELECT is also mistaken for the base. The actual guarantee is only “nothing published after this unlocked SELECT.”

   Exactness needs durable lineage—an immutable `based_on_revision_id`—or reopened drafts must fail closed/restart. Add a red test with mint from R1 → release → publish R2 → reopen → attempt publication.

2. **High — an all-skipped publication refusal does not record a failed job.**

   A refusal from a last step is caught by `runStep`, after which a second transaction marks the step/job failed and discards the draft. That path is sound.

   But an all-skipped claim reaches [`endJob(...done)`](/home/greg/code/spideryarn2/src/jobs.ts:1453) directly. If [`pgStoreSession.settleJob`](/home/greg/code/spideryarn2/src/store/pg-session.ts:576) throws `PublishRefused`, `walkClaim` catches only `StaleAttemptError` and rethrows.

   Consequences:

   - publication rolls back;
   - the job remains `running`;
   - the draft pointer remains held;
   - the browser retries `/advance` until lease expiry;
   - the local pump stops immediately;
   - without another advance, the job can remain running indefinitely;
   - a later lease sweep records a generic interruption, not the actionable publication conflict.

   The supplied test drives only `commit`, so it cannot catch this. Add an all-skipped coordinator test and require an immediate terminal error with the draft failed and pointer cleared.

3. **High — the retry endpoint now permits unlimited paid reruns of successful refreshes.**

   [`retryJob`](/home/greg/code/spideryarn2/src/jobs.ts:2072) checks only that the job exists. The route exposes it without checking terminal status. Therefore:

   1. Complete a forced PDF refresh successfully.
   2. POST its `/retry` endpoint.
   3. Its all-done forced steps are re-forced by the new rule.
   4. Repeat against each completed replacement job.

   This can pay for transcription indefinitely without any failure. The UI hides Retry on successful jobs, but the server is the authority. Restrict retry to `error` or `cancelled` jobs—probably also enforcing `jobWorthRetrying`.

   Apart from that API hole, there is no automatic retry of failed jobs. Repeated manual retries or repeated late failures can still pay N times, so “a second time” is an example, not a bound.

4. **Medium — item 3’s test reproduces the composition instead of testing its wiring.**

   [`tests/retry-after-a-failed-refresh.test.ts:122`](/home/greg/code/spideryarn2/tests/retry-after-a-failed-refresh.test.ts:122) manually calls `forceForRetry` and `cascadeForce`. It stays green if:

   - `retryJob` stops passing `forceForRetry(old.steps)`;
   - `enqueue` ignores the supplied force set;
   - persisted job flags are lost.

   A store-backed retry test can verify the new job’s actual flags without a network fetch or paid hierarchy call. The claim that an end-to-end consequence test requires those calls is overclaimed; injected fake stages can reproduce the discarded-draft sequence.

   The stated reason for retaining the full set is also not exercised: the fixture contains no `FORCE_ONLY_WHEN_NAMED` step such as `tweets`.

5. **Low — comments and docs state stronger guarantees than the code provides.**

   - [`DraftBase.revisionId`](/home/greg/code/spideryarn2/src/store/pg-session.ts:180) is described as the revision the draft was copied from, which is false for `reopened`.
   - “Nothing published while this claim held it” is false; the value is read after the claim and after the reopen transaction.
   - [`database.md`](/home/greg/code/spideryarn2/docs/project/database.md:210) states the universal exact-base invariant despite the reopened hole.
   - [`ingest-queue.md`](/home/greg/code/spideryarn2/docs/project/ingest-queue.md:810) says an ordinary retry never reruns successful steps. Under Postgres, a failed draft is discarded; unforced freshness checks may correctly rerun those lost steps.
   - The stored flags are the cascade-expanded effective force set, not “exactly what the original request asked for.”
   - `REFRESH_THAT_DIED_AT_TOC` remains after the hierarchy rename.

## Direct answers

1. **409 is appropriate** for a publication conflict, and the last-step transaction does roll back artefact writes, step completion, publication, and job finish together. The step returns to `running`, then the failure settlement marks it `error`. The all-skipped path is the exception described above.

2. **A last-step refusal becomes a terminal, manually retryable error.** An all-skipped refusal currently leaves the job running until another advance eventually sweeps the lease.

3. **Yes, it can be paid repeatedly.** Repeated manual failures do it, and more seriously the unguarded retry endpoint allows successful forced jobs to be rerun indefinitely.

4. **The exact-base positive control escapes the carry-forward trap:** if the write disappears, the carried arc remains and the `ARC_JOB` readback fails. The item 3 test is pure and therefore neither passes nor fails over carried artefacts; it does not prove the described database consequence.

5. The principal overclaims are the reopened lineage guarantee, immediate failure recording, “ordinary retries never rerun successful steps,” and the assertion that a non-paid integration test is impossible.

`npx tsc --noEmit` passed. Scoped Biome lint exited successfully with existing advisory warnings in `jobs.ts`. Vitest could not start in this read-only review environment because Vite attempted to create its temporary config/cache directory.