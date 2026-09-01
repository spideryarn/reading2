## Verdict

No HIGH or MEDIUM findings. Stage 3 reaches the returning-reader case safely, and the owner filter and gate are correct for every legal store state.

I found two LOW test gaps, one harmless concurrency window, and one inaccurate filesystem comment.

## Findings

1. **LOW — a concurrent advance sweep can make `listJobs()` return its stale first read.**  
   At [src/jobs.ts:2356](/home/greg/code/spideryarn2/src/jobs.ts:2356):

   - list reads expired job as `running`;
   - concurrent `/advance` globally settles it;
   - the scoped sweep returns `[]`, because it lost the update race;
   - line 2357 returns the original `running` snapshot.

   Nothing is corrupted or stranded. The engine may send one redundant advance, and the next one-second poll corrects the display. I would accept this rather than always paying a third statement, but the claim that “nothing settled means the answer did not change” is too strong.

2. **LOW — the “same answer” test does not actually pin the re-list.**  
   [tests/list-reconciles-expired.test.ts:154](/home/greg/code/spideryarn2/tests/list-reconciles-expired.test.ts:154) would still pass if line 2374 were replaced with `return listed`.

   That is because [fsJobStore.list](/home/greg/code/spideryarn2/src/store/jobs-fs.ts:305) returns references to the live in-memory objects, and `settleExpired` mutates those same objects. The supposedly pre-sweep result changes underneath the test. Assert that `list` was called twice after a settlement, or exercise this orchestration with a detached/mocked store result.

3. **LOW — the logging test does not pin “ids and endings” or `where`.**  
   [tests/list-reconciles-expired.test.ts:244](/home/greg/code/spideryarn2/tests/list-reconciles-expired.test.ts:244) only looks for the id and the word `settled`. It passes a log with no status and no `where: "list"`. Parse the JSON and assert `count`, `where`, and `settled: [{ id, status: "error" }]`.

4. **COMMENT — the filesystem rationale names the wrong recovery mechanism.**  
   [src/store/jobs-fs.ts:442](/home/greg/code/spideryarn2/src/store/jobs-fs.ts:442) correctly filters before deleting, but says a deleted foreign token could later be repaired by the table-wide sweep. It could not: that sweep also iterates `attempts`, so deleting the entry makes the running row invisible to it. Restart’s `sweepStopped`, or that owner pressing Stop, would recover it.

## Answers

1. **Owner filter:** correct and complete. PostgreSQL includes ownership in the atomic `WHERE`, and the filesystem filter belongs before every mutation. The owner-isolation invariant is the strongest explanation: a scoped call leaves foreign state byte-for-byte untouched and preserves the entry a later global sweep needs.

   A scoped sweep does not create any state the global sweep cannot fix. A pre-existing filesystem `running` record with no attempt is invisible to both sweeps, but Stage 3 did not create that asymmetry.

2. **Gate:** correct for legal states. Every expired lease that matters belongs to a `running` job; PostgreSQL’s check constraint enforces that shape, and the filesystem claim writes status and attempt synchronously. A corrupt PostgreSQL row with a missing lease still says `running`, so the gate opens. A concurrent queued→running transition after the first list can delay reconciliation by one poll, never permanently close the gate.

3. **Re-list:** reading again is correct and returns the latest store truth, including a concurrent Retry or cancellation. It does not introduce a harmful window. The only wrinkle is the loser-of-the-sweep race described above: when `/advance` settles first, this call returns its stale first read because its own settlement count is zero.

4. **Tests:** the two-owner parity case is sufficient and well designed. It catches an ignored owner argument, post-update filtering, over-broad settlement, and—because the second owner must subsequently settle successfully—premature filesystem token deletion.

   Concrete broken implementations that still pass:

   - remove the final re-list and return `listed`;
   - log the id and “settled” but omit the ending and `where`;
   - allow the advance door to win between the first list and scoped sweep, returning stale `running`.

5. **Logging:** the production line is good. Timestamp, component, count, opaque job id, terminal status, and door are enough to investigate. It contains no URL, filename, owner id, profile, article prose, attempt token, or error prose. I would not add owner or slug. The implementation is stronger than its test.

6. **Filesystem asymmetry:** agreed within its stated single-process contract. No legal same-process transition produces `running` without an attempt: claim creates both; release and finish change status before deleting the attempt; startup requeues disk records. Two processes sharing the directory remain explicitly outside the adapter’s guarantees.

7. **Measurement:** the statement-count conclusion is sound and is the useful headline: ordinarily 1→2 while running, with a one-off 1→3 poll when a settlement causes the re-list. The local latency measurement is directionally useful but cannot establish “nearly all round trip” without separate server execution timing. It also should not support “under a second” outside the local setup; production latency is explicitly a floor.

   The benchmark script and raw samples are not in the commit, so the latency ranges are not independently reproducible. The ~520 count is appropriately approximate: hidden tabs, response duration, session/action pokes, and the final three-statement poll alter the exact total.

8. **Stages 4–6:** nothing material is broken.

   - Stage 4 must continue treating lease state as server-only. It may briefly receive stale `running` for one poll in the race above.
   - Stage 5 should use `finishedAt` for terminal elapsed time. `startedAt` survives retries, so it measures total job age, not the current attempt.
   - Stage 6 should not use `listJobs()` as a pure lookup: it now mutates, logs, and sometimes re-reads. The blocking-job identity still needs to come from the atomic claim/conflict result, not from an earlier list.
   - Any future third `settleExpired` parameter is the point to replace `undefined, owner` with an options object.

I reviewed the committed files at HEAD and ran the diff whitespace check successfully. I did not rerun the suites because this review environment is read-only and these tests write filesystem fixtures and local database rows.