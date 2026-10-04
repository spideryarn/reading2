# Plan review: 261004g, the Overseer's report drain checks git without blocking the daemon

You are reviewing a **plan**, read-only. Nothing is built yet. Do not change any file.

## The candidate

- Base: this worktree's HEAD (`git rev-parse HEAD`).
- Untracked file, the plan itself:
  `docs/plans/261004g-overseer-report-drain-artefact-checks-stop-blocking-the-daemon.md`.
- It describes changes to: `tools/overseer/report-artefacts.ts`, `tools/overseer/reports.ts`
  (`drainReports`), `tools/overseer/daemon.ts` (the reports ticker, `guard`, `settleInFlight`),
  `tools/overseer/store.ts` (one private method made public), `scripts/overseer.ts`
  (`makeReportDrain`), `tests/no-sync-child-in-long-running.test.ts`, the daemon and reports tests,
  and one row of `docs/plans/261003f-fifth-codebase-sweep-umbrella.md`. Where to start, not a limit.

## Context

This is the Overseer daemon: orchestrator code, held to a higher bar than the rest of dev. It is
the thing reached for when something else is broken. Small changes, each proven by a test.

The parent is `docs/plans/261004c-sweep-cluster-11-no-blocking-child-process-on-the-dashboard-or-the-daemon.md`.
Your own finding F4 on that plan said an async report drain is more than an adapter: the drain's
promise has to be held and settled on both exit paths before the store is released, and ownership
rechecked after each awaited git call, with suspended-drain tests for shutdown, a throwing source
and lock loss. Stage 6 was therefore not built there. This plan is that job.

The owned child is `tools/fleet/child.ts` (`processProbeOwner`, `ProbeOwner.run`, `OwnedOutcome`).
Sibling conversions to compare with: `tools/overseer/attention-probe.ts`, `tools/fleet/readiness-git.ts`
(`snapshotDevAsync`), and the daemon's `takeProbed`.

## What to do

Independent pass first. Attack the plan: is any claim in it false against the code? What breaks
that it does not name? Is there a simpler version? Trace the real code paths rather than trusting
the plan's or a comment's account of them.

Grade by consequence: **P0** data loss, a second writer, a daemon that cannot stop or restart;
**P1** wrong recorded state or an authoritative contract violated; **P2** design or maintainability
risk; **P3** prose. Give every finding an ID (F1, F2, …), a file:line, and say whether it is
*established* (direct evidence) or *reasoned*. End with a one-line verdict:
`VERDICT: build as planned` / `VERDICT: build with changes` / `VERDICT: do not build`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. The plan claims `drainReports` has exactly one call out and that nothing has been written for
   the current report when it is made. Check every write and every in-memory change between the
   top of the candidate loop and `options.checkArtefact(ref)`, and what state an abandoned pass
   leaves for the next daemon's drain (the `files`, `bytesRead`, `probes` counters; `inFlight`).
2. A generator suspended at a `yield` inside a `try`/`catch` inside two `for` loops: is sending a
   value, throwing into it, and returning from it each as the plan says? Is a generator the right
   call here against a plain `async` function, given this is orchestrator code people must read?
3. The mapping from `OwnedOutcome` to `GitResult`: is the owner's `why` on a failed exit really the
   text the stderr regexes in `checkCommit` / `checkPath` need, in every case (`stderrSuffix`)?
   Exit code 128 from git when the directory is not a repo; a `failed` with a null exit code.
4. While the drain is suspended the daemon's other timers run. Does anything they do (the
   heartbeat's checkpoint, the jobs ticker, a payload's fold moving `store.register`, the recovery
   passes) conflict with a drain resumed afterwards? The drain reads `options.register` after its
   checks: is "the register as it is after the checks" still the right reading for `receivedAt`?
5. `guard(store.checkOwnership())` called from inside the drain's driver sets `stopped`. Is setting
   `lock-lost` from there safe with respect to the main loop and `stopHere`?
6. The wall-clock limit (`wallMs` 5 s) used to bound a blocked daemon. With awaits, is it still the
   right bound, and can a `refused` child make every later reference in a pass `unchecked` in a way
   that is worse than today's behaviour?
7. Is the shutdown wait (2 s + 1 s grace) acceptable against systemd's stop timeout and the other
   settlements already in `settleInFlight`?
