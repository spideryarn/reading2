**BUILD WITH CHANGES.** The direction is sound, but stages 1, 3 and 5 need concrete corrections before implementation.

I reviewed the committed plan at `18017a2ec`. I changed no files. Stage 1 implementation edits appeared in the shared worktree during the review; the findings below concern the committed plan.

1. **F1 — P1 — ESTABLISHED: checking `signal` first does not fix the proposed diagnostic.**

   At HEAD, [work-probe.ts](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/overseer/work-probe.ts) checks `error` before `signal`. But a child that ignores TERM and subsequently exits normally has **`signal: null`**.

   I reproduced the proposed fixture’s behaviour without writing a file: timeout 200 ms, child exits after 1.5 s; result was **1,586 ms elapsed, status 0, signal null, error `ETIMEDOUT`**. Reordering the two branches still returns “could not be run” without the measured clock.

   **Change:** detect `error.code === "ETIMEDOUT"` explicitly. Distinguish “killed by SIGTERM” from “signalled, then returned later”; include elapsed time and the signal deadline in both cases.

2. **F2 — P1 — ESTABLISHED: `collectHealthAsync().verdict.level` does not enforce the plan’s refusal policy.**

   [health.ts:430](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/fleet/health.ts:430) considers the core reading available when *any* of load, memory or swap is readable. Owner refusal becomes an ordinary unknown field, losing its outcome kind.

   I injected an owner refusing `uptime`, `nproc` and `free`, while returning a normal low-use swap reading. The resulting verdict was **`"ok"`**, with load and memory unknown.

   Concurrent launch requests can produce this pattern: one owns the first three health keys; another is refused those keys and starts subsequent probes. If the first request discovers critical load and refuses launch, the second can still claim the free launch slot using its partial `"ok"` reading.

   **Change:** preserve refusal as explicit collection evidence and make the admission wrapper return `unknown`, as the plan requires. Test **partial** refusal and two concurrent requests; testing only a wholly refused survey misses this.

3. **F3 — P1 — REASONED: awaited `take()` can expose a partially applied inventory to recovery.**

   [daemon.ts:1850](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/overseer/daemon.ts:1850) advances `accepted`; it computes the diff at line 1874 and probes at line 1930. The register, baseline and trusted inventory are updated later.

   Adding `await` at the existing probe position lets the heartbeat run recovery while **`accepted` belongs to the new snapshot and `inventory`/register belong to the previous one**. [The resume observer](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/overseer/daemon.ts:1121) combines that inventory with health and capabilities from `accepted`.

   **Change:** keep admission publication and durable fold in one synchronous stretch after the probe. Preserve the accepted-on-held behaviour separately, and recheck halt/ownership after awaiting.

   Converting this probe **is worth doing**. Payload ordering itself is straightforward: change the sole call in the `for await` loop to `await take(...)`. That prevents overlapping payload folds. The timer interleaving above is the harder issue.

4. **F4 — P1 — REASONED: an in-flight flag does not preserve report-drain ownership through shutdown or lock loss.**

   [reports.ts:1223](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/overseer/reports.ts:1223) requires the daemon’s lock. The drain writes report files directly; [its commit function](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/overseer/reports.ts:1288) does not check store ownership.

   After conversion, clearing `reportsTicker` prevents another pass but leaves an awaited artefact check alive. [settleInFlight()](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/overseer/daemon.ts:1599) currently does not await reports. Shutdown could release the lock before the old drain resumes writing. Separately, a heartbeat can discover lock loss during the await; merely awaiting the drain afterward does not authorize its writes.

   **Change:** retain the drain’s promise, contain rejection, clear it in `finally`, and settle it on both exit paths before releasing the store. Recheck ownership before the synchronous prepare/commit stretch after each awaited check. Add suspended-drain tests for normal shutdown, throwing source and lock loss.

   The register reference itself is live: [store.ts:3783](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/overseer/store.ts:3783) returns the map that `foldEvents` mutates. Reading execution attribution after the checks, then freezing the prepared bytes without another await, can preserve the existing receipt-time semantics.

5. **F5 — P1 — ESTABLISHED: heartbeat counts are not scheduling-opportunity counts.**

   [ticks()](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tests/helpers/overseer-until.ts:34) reads the heartbeat counter. The heartbeat and [jobs timer](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/overseer/daemon.ts:1516) are separate callbacks. Heartbeats can advance while the scheduler never runs—the very failure these negative assertions need to exclude.

   There is another case the blanket replacement cannot handle: [the report-timer shutdown tests](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tests/overseer-daemon-recovery.test.ts:1047) check that nothing runs **after daemon termination**, when no further heartbeat should exist.

   **Change:** observe actual completed scheduler/recovery opportunities for their negative assertions. Keep `tickAfter` for checkpoint publication and heartbeat watchdog tests. For post-shutdown timer assertions, advance controlled timers through several would-be intervals. Mutation controls should include disabling the relevant callback; changing the assertion’s subject alone does not prove opportunities occurred.

6. **F6 — P2 — ESTABLISHED: the flat guard is useful, but its proposed coverage is narrower than its claim.**

   A guard examining only `ImportDeclaration` misses:

   - `require("child_process")`, literal dynamic `import()`, and direct re-exports.
   - A wrapper imported from outside the scanned perimeter.
   - New code extensions outside `.ts`.
   - Additional sync imports or calls inside an already excepted file.
   - A new dashboard caller of an excepted sync helper, such as `collectHealth`.

   **Change:** keep the flat scan and literal equality, but inspect or explicitly reject runtime loading/re-export forms for both module spellings. Self-test aliases, namespace/default imports, declaration-level and specifier-level type imports, and parse failure. Existing `fleet-imports.test.ts` already demonstrates several of these controls.

   File-list equality catches newly offending files and stale exceptions. It does **not** prove that an exception remains CLI-only or that its call count only shrinks. State that limitation explicitly.

7. **F7 — P2 — ESTABLISHED: separate owners are not equivalent to the server’s shared owner.**

   The plan says the keys are distinct. Both the background health pass and proposed admission pass use [the same `health:*` keys](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/fleet/health.ts:747). Separate registries permit siblings and separate health-child caps; a shared registry refuses overlapping keys.

   **Change:** choose the health concurrency policy explicitly. I favour a shared process owner with deliberate sharing/coalescing of concurrent health requests. Simply threading the owner through also needs testing: it introduces collisions with background health. A collection of module owners is not worth adopting on an incorrect equivalence claim.

8. **F8 — P2 — ESTABLISHED: the async relation cache is unnecessary scope.**

   My repo-wide search found `makeRelationCache` only in its definition and one test. The dashboard calls `snapshotDev`; it does not call `relate`.

   **Change:** build only the async primary-checkout resolution and `snapshotDev` path required by readiness. An async `relate` adds an unused API and cache concurrency questions. Sharing argument/result helpers is reasonable; duplicating the relation orchestration is not worth its keep.

9. **F9 — P1 — REASONED: async readiness must pin refs before calculating its reported tuple.**

   [snapshotDev()](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/fleet/readiness-git.ts:202) reads HEAD, then calculates behind using the mutable name `HEAD`; trunk gap uses mutable `origin/main..origin/dev`.

   With awaits between these operations, another dashboard git action can move refs. The result can name one `primarySha`/`devSha` while its counts describe different commits. External writers already make this possible; conversion additionally allows this server’s own requests to interleave.

   **Change:** resolve the relevant refs to immutable SHAs and calculate counts from those SHAs. Test a ref movement between reads.

The census is complete for today’s direct calls: my grep and independent Babel count both found **18 calls in 14 files under `tools/`, plus one in `scripts/overseer.ts`**.

Attention’s reachability is resolved: `scripts/overseer.ts` supplies `attentionRunner`, which calls both `tmuxGeneration()` and `listSessions()` in [attention-cli.ts:445–460](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c11-blocking-child-process/tools/overseer/attention-cli.ts:445). Its CLI-only header is false. Convert both probes. `capturePane` also remains on that daemon path, within the deliberately deferred `pane.ts` scope.

The remaining await boundaries need these explicit policies:

| Conversion | Interleaving to account for |
|---|---|
| Action process scans | Other scans/actions can run between args, comm and cwd reads. Preserve failure mapping, existing identity checks and buffer limits; test overlapping scans and partial failure. |
| Auth status | Usage passes already yield and the daemon already prevents overlap. Preserve reading timestamps and failure attribution; no new daemon-level exclusion is needed. |
| Health admission | Preserve the existing final synchronous slot recheck/claim after health completes. Address F2/F7. |
| Rename | Another rename/new-session/kill request can run between listing, validation and mutation. Choose whole-operation admission or serialization explicitly; probe-key exclusion is not whole-operation exclusion. Test same-session overlap and target-name contention. |
| Attention | Awaited generation and session listing can span a tmux restart. Validate generation consistency before carrying old waits into the new pass. Its existing pass guard prevents overlapping daemon attention passes. |
| Readiness | Set the latch before the first await and clear it in `finally`; publish only a completed snapshot. Awaiting it inside the main refresh loop also delays the next fleet refresh—choose that scheduling behaviour explicitly. |

Each stage can be a safe stopping point **with those changes**. Stage 3 should be split into separately committed work-probe, report-drain and attention changes; the report conversion is substantially more than a probe adapter. Stage 4 should finish the dashboard’s actual git path, without the unused relation twin. If a live probe remains deferred, record that as an incomplete conversion; a shorter exception list alone is insufficient completion evidence.

**Verdict: BUILD WITH CHANGES — fix F1–F5 before building, strengthen the guard, settle health ownership, remove async `relate`, and pin readiness refs.**
---

Up: [the plan](261004c-sweep-cluster-11-no-blocking-child-process-on-the-dashboard-or-the-daemon.md)
