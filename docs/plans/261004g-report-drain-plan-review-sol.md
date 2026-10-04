Reviewed against HEAD `297d62c6226331ebbcbe2f1d9b1386673de8f2a1`. I made no edits; concurrent working-tree changes were excluded.

1. **F1 — P0, established: setting `stopped` does not wake the source loop.**  
   [Plan:78](/home/greg/code/spideryarn2/.claude/worktrees/overseer-report-drain-async/docs/plans/261004g-overseer-report-drain-artefact-checks-stop-blocking-the-daemon.md:78)

   `guard` only assigns `stopped` (`daemon.ts:842–845`). The main loop can remain awaiting `source.next()` indefinitely. The real source resets its silence deadline on incoming pings but yields nothing for them (`source.ts:415–424`). Consequently, drain-detected lock loss can halt the timers’ work without ever reaching settlement or `stopHere`.

   This is an existing lifecycle weakness inherited by the proposed stop path. An in-memory probe confirmed that repeated pings kept the real source’s next result pending until abort.

   **Change:** give the daemon an internal cancellation signal that wakes the source on lock loss. Test drain-detected loss with a source that keeps receiving pings and supplies no further payload.

2. **F2 — P1, established: source completion and failure do not abandon the drain.**  
   [Plan:78](/home/greg/code/spideryarn2/.claude/worktrees/overseer-report-drain-async/docs/plans/261004g-overseer-report-drain-artefact-checks-stop-blocking-the-daemon.md:78)

   Neither normal source completion nor the throwing-source path sets `stopped` or aborts `options.signal` before settlement (`daemon.ts:1742–1747`, `2141`). With ownership intact, the proposed `stillOwner()` therefore returns **true** during these exits. The drain continues checking and recording reports, contradicting the promised abandonment and the throwing-source test.

   **Change:** mark the daemon as exiting before settlement on both paths, and include that state in the drain’s continuation check. Test source completion and source failure without externally aborting the signal.

3. **F3 — P1, established: the ownership fence is after a reference, not after every git call.**  
   [Plan:80](/home/greg/code/spideryarn2/.claude/worktrees/overseer-report-drain-async/docs/plans/261004g-overseer-report-drain-artefact-checks-stop-blocking-the-daemon.md:80)

   `checkCommit` calls both `cat-file` and `merge-base` (`report-artefacts.ts:65`, `71`). Awaiting the whole checker and then calling `stillOwner()` allows `merge-base` to start after shutdown or lock loss during a successful `cat-file`. A reference can consume two child budgets, rather than the claimed single 2 s + 1 s budget.

   **Change:** check continuation between the git calls. Test interruption during the first call, then release it successfully and assert that the second command never starts.

4. **F4 — P1, established: abandonment can falsely restore the reports condition.**  
   [Plan:82](/home/greg/code/spideryarn2/.claude/worktrees/overseer-report-drain-async/docs/plans/261004g-overseer-report-drain-artefact-checks-stop-blocking-the-daemon.md:82)

   The plan preserves the restoration note on an ordinary stop. If a previous pass degraded `reports`, an aborted pass returning `"abandoned"` would clear that condition and record “a report drain pass completed” (`daemon.ts:1584`). That is false: the pass was abandoned. `notes.ts:279–284` explicitly establishes that a clean stop does not cure an open condition.

   **Change:** skip restoration for abandoned outcomes. Test a degraded reports condition followed by a suspended pass that is abandoned during shutdown.

5. **F5 — P2, reasoned: the generator adds protocol complexity without enforcing the claimed boundary.**  
   [Plan:66](/home/greg/code/spideryarn2/.claude/worktrees/overseer-report-drain-async/docs/plans/261004g-overseer-report-drain-artefact-checks-stop-blocking-the-daemon.md:66)

   `Generator<Ref, Outcome, Check | "abandon">` constrains values, not the number or placement of suspension points. Preserving synchronous tests is useful, but does not prove the extracted body stayed unchanged.

   The drivers also need explicit rules: `.throw(cause)` returns the next yielded reference or final outcome; that result must be processed directly. Checker exceptions must be caught separately from generator-body exceptions. Ownership must be checked after rejection before throwing into the generator, since that resumes synchronous processing of later reports.

   **Recommendation:** prefer one plain async drain and migrate the tests. If retaining the generator, specify these rules and test rejection followed by another checked report, plus rejection after ownership loss.

The remaining suspected issues check out: counters and `inFlight` are local to each pass and need no rollback; a report reaching the checker has no prepared file yet; the register is the same live Map and is read alongside the newly stamped `receivedAt`; and numeric failed outcomes retain captured stderr through `stderrSuffix`, while null exits remain unchecked. The 5 s wall limit still bounds pass admission. The report wait alone fits systemd’s 30 s stop timeout, but existing attention/usage settlements already prevent claiming a total shutdown bound.

VERDICT: build with changes