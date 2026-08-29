NO-SHIP

1. **Critical — verified: terminal and failure settlement is still undefined.** The draft leaves [`settleJob` as a standalone transaction](</private/tmp/claude-501/-Users-greg-Dropbox-dev-experim/spideryarn2/cb1f6352-212a-4617-954a-5ead31cb1813/scratchpad/d1b-design-draft.md:19>) and does not add the planned `StoreSession.fail`. PostgreSQL `finish`, `releaseStep`, `failExpired`, and `requestCancel` do not clear `draftRevisionId` ([pg-jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:252)). The sweeper then protects those terminal jobs’ drafts indefinitely.

   More seriously, `releaseStep` can return `cancelled` after a concurrent Stop. The requested transition was “release”, so the current `void` commit interface cannot report that the job actually ended, fail the draft, or make `/advance` return the correct terminal result.

   Smallest correction: specify one PostgreSQL settlement state machine covering:

   - nonterminal success: write, validate, finish step, release, retain draft;
   - terminal success: write, validate, finish step, publish, finish job, clear draft;
   - stage failure/cancellation: finish the run as error where applicable, fail/clear the draft, end the job;
   - release resolving to cancellation: fail/clear the draft and return the actual settlement;
   - all-skipped: explicitly publish or discard the copied draft—do not merely finish the job.

   `commit`/`settleJob` must return the actual settlement, not infer it from the requested transition.

2. **Critical — verified: the declared dependency cannot provide atomic job settlement.** [`pgStoreSession(... jobs: JobSettles)`](</private/tmp/claude-501/-Users-greg-Dropbox-dev-experim/spideryarn2/cb1f6352-212a-4617-954a-5ead31cb1813/scratchpad/d1b-design-draft.md:9>) receives methods whose implementations use `getDb()` independently. Merely extracting `releaseStepIn` and `finishIn` does not make that injected object transaction-bound.

   What breaks: artefacts and step state can commit while release/finish fails separately—the exact D1 finding.

   Smallest correction: have the PG session call explicit `releaseStepIn(tx, …)` / `finishIn(tx, …)` helpers, or inject a factory bound to the session’s `tx`. Do not accept the public `JobSettles` capability. Translate `NotTheLiveAttempt` to `StaleAttemptError` at this boundary as well.

3. **Critical — verified: importer and prune exclusion disappeared from D1b.** The accepted plan assigned this to D1b, but the draft never mentions it. Import currently takes an article write lock and then replaces its revision data inside a long transaction ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:488)); prune changes the article pointer and deletes it ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1251)).

   What breaks: an import may replace the base beneath an active draft, while prune can cascade-delete state owned by a live job.

   Smallest correction: both operations should lock the article, then refuse any queued/running job for that owner and slug before changing revisions or reader state. This is also evidence for article-before-job as the canonical order.

4. **High — verified: three listed tests are not honestly reachable, and the essential positive test is absent.** With production still hardwired to `fsStoreSession` and every real step refused by the PG session, the following cannot exercise the claims as written:

   - simultaneous `/advance` requests;
   - PG preflight despite filesystem files;
   - the coordinator’s all-skipped PG path.

   Directly calling a PG session helper would prove different behavior. Also, “both `/advance` claims succeed” conflicts with the one-running-job constraint: one may claim while the other finds no work.

   Test 3 also needs a specified failure point after artefact writes but inside the same transaction; a normal `JobSettles` stub would be outside the transaction and prove nothing.

   Smallest correction: add a narrow internal coordinator entry point accepting a session factory and step registry; production supplies the current defaults. Add at least:

   - a successful final fake step proving artefacts, completed run, published revision, finished job, and cleared draft pointer;
   - a concurrent Stop test proving release-to-cancel rolls back or discards the draft correctly.

   The first is the missing seventh test; the second is also necessary because it justifies taking the article lock on nonpublishing commits.

5. **Medium — verified: `publishRevisionIn` would not be a pure extraction while it logs inside a caller-owned transaction.** The pre-update `article.currentRevisionId` remains correct because the article row is locked. But [`logger.info`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1212>) can report publication and then have the outer transaction fail during job settlement.

   Smallest correction: return the log fields from `publishRevisionIn`; log only after the outer transaction commits. Apply the same rule to any extracted failure helper.

### Lock decision

**Article then job is the right order.** It agrees with publication/failure and with all article-wide writers. It also handles the non-obvious case where a nominal release discovers cancellation and must dispose of the draft.

Taking the article lock before the artefact fence is essential. If the transaction first acquires the job lock and later calls `publishRevisionIn`, it still has job→article ordering; being inside one transaction does not prevent a deadlock with another article→job transaction. Re-locking an article already locked by the same transaction is safe.

The cost appears acceptable:

- PostgreSQL does not escalate these row locks.
- Ordinary reader `SELECT`s remain unblocked.
- Shelf updates, chat/search/visibility mutations, imports, and other article writers will wait.
- The lock spans database validation reads and writes, but not the model call.

That writer contention is a performance risk to measure, not a correctness objection.

The `openOrBeginJobDraft` exception is narrowly safe today. Current coordinator calls cannot open and commit the same job concurrently, and `failExpired` does not create the required cycle: a replacement job has a different job row, while the stale worker fences against the old row. However, because `openOrBeginJobDraft` already has the article identity before locking the job, I would still reorder it article→job in D1b. It is a small change that establishes one enforceable invariant instead of depending on caller sequencing.

`failExpired` creates a real cleanup problem, but not the proposed deadlock. At minimum, the sweeper must protect only active-job draft references; any deeper `failExpired` cleanup must itself avoid taking article after job.

### D3 and the cheaper boundary

D3 should undo none of the PG session. It should only convert `arc` to return products and remove it from `LEGACY_UNCONVERTED_STEPS`, then add a real-product integration test.

A second `StoreSession` implementation is the cheapest sound design. Share the pure pieces—`checkProduct`, `readsOf`, and perhaps a tiny transition dispatcher—but keep filesystem and transaction mechanics separate. Generalizing transactions across both stores would add machinery without reducing the atomic risk.

Trace: I read the D1b draft, `vision.md`, the main deletion plan and prior D1/D1a reviews, `session.ts`, coordinator flow, PostgreSQL revisions/jobs/artefacts, importer/prune, shelf, chat, search, visibility, schema constraints, cleanup paths, and relevant tests. I searched the repository for article/job row locks and article mutations. I ran only read-only filesystem and Git inspection; I did not run tests that write to PostgreSQL, migrations, or any database mutation. No D1b implementation existed to inspect, and I could not measure live lock-wait latency without executing writes.