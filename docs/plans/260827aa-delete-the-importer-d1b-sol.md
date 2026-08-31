NO-SHIP

1. **Critical — terminal drafts still leak.** [`failExpired`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:276) and queued [`requestCancel`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:325) make jobs terminal without clearing `draftRevisionId`. The sweeper protects pointers from every job, including terminal ones. Both paths are reachable after a step releases.

   Smallest correction: clear the pointer in `failExpired` and conditionally for queued cancellation; add tests starting with a real draft pointer.

2. **High — case 3 does not finish the step run.** A failed or aborted stage leaves the row created by `beginStep` as `running`. [`settleIn`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-session.ts:277) fails the revision and job but never calls `finishStepRun(...status: "error")`, despite that operation already existing at [`pg-revisions.ts:991`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:991).

   Smallest correction: carry the begun step’s identity into failure settlement and mark it `error` before failing the draft and job, in the same transaction.

3. **High — the rollback test can pass on the wrong exception.** [`rejects.toThrow()`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-pg-session.test.ts:952) accepts an error from anywhere before `finishIn`. An early write or validation error would leave every following “rolled back” assertion unchanged, so the test would remain green without reaching publication.

   Smallest correction: require the scrubbed expected failure, including SQLSTATE `23502`. That also proves errors from the free `finishIn` helper pass through the session guard.

4. **Medium — `discardAfterCancel` is safe only on the intended commit path.** There, `writeArtefacts` already proved job, attempt, status, and draft ownership; the row remains locked through `releaseStepIn`, so the unfenced clear is sound. But [`settleJob` accepts any `JobTransition`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/session.ts:218), including `release`, without that earlier draft fence. `releaseStepIn` checks job/attempt/status, not the draft pointer. Its “full fence” justification is therefore not universally true.

   Smallest correction: narrow `settleJob` to `end` transitions, which matches every current caller, and throw rather than warn when the conditional pointer clear affects anything other than one row.

5. **Medium — two tests fall short of the silent-success standard.**

   - The lock test uses a one-second sleep at [`tests/store-pg-session.test.ts:1112`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-pg-session.test.ts:1112). A slow unlocked commit can falsely pass. Use `pg_blocking_pids`, as the draft-lock suite already does.
   - The all-skipped test publishes a byte-for-byte copy. It proves that publication was invoked, but discarding would have the same reader-visible result. Add the actual two-request case: request one writes and releases; request two skips everything; the first request’s new work must become visible.
   - The cancellation test exercises the session directly, not the coordinator consuming `JobSettlement`. A gated fake step plus concurrent Stop should assert `advanceJobWith` returns `done: true`.

The core transaction itself is verified: in the scoped snapshot, `commit` locks the article first, then performs the artefact fence/write, postcondition, step completion, publication/failure, and job transition through the same `tx`. `settleJob` also locks article before job. Re-locking inside publication/failure does not invert the order. Logging occurs only after the transaction resolves.

Publishing on all-skipped is the correct simple rule. It preserves work committed by an earlier request. I found no case where publication corrupts or loses data; a completely no-op job merely creates an identical revision.

`guardDbStore` preserves the generic signatures by returning `T`, copies non-function properties, and `reads` is separately wrapped. Rejections from `releaseStepIn`/`finishIn` occur inside wrapped session methods, so they are scrubbed. The test does not fully prove that last point, but the control flow does.

D3 should undo none of D1b. It must convert the six late stages to return `parts` and `stamp`, remove each legacy exemption, and test real products through the injected PostgreSQL session. `assets` may still write content-addressed blobs during `run`; only its manifest belongs in the transaction. The importer/prune split was acceptable because D1b does not switch production storage; that exclusion has since landed separately as `4594bd7`, outside this review.

Trace: I read the scoped diff, the main plan’s D1/D1b sections, the prior D1b review, `silent-success.md`, the coordinator, session implementations, PostgreSQL artefacts/jobs/revisions, schema constraints, all ten session tests, and the late-stage definitions. I ran the tests TypeScript project: its only error was the unrelated peer edit `src/routes.ts:145`. Scoped Biome lint completed with one existing comma-operator warning and complexity advice. I did not run Vitest or reproduce database mutations because your instructions prohibit database writes; therefore the reported 10/10 and mutation runs were audited from source, not independently rerun.