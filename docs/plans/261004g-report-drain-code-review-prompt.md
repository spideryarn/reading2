# Code review: 261004g, the Overseer's report drain checks git without blocking the daemon

You are reviewing **built code**, and you may fix what you find **inside this stage**: write the
failing test first, see it red, fix, see it green. Anything wider than this stage, report and leave.
Do not commit. Do not restart the Overseer daemon or the fleet dashboard, and do not run
`npm run deploy`. Do not put words in anybody's mouth: if you edit a doc, do not attribute a sentence
to Greg, and do not write a dated quote of anyone.

## The candidate

- Base: `origin/dev`. The candidate is this worktree: its commits since `origin/dev`, plus the
  working tree. `git diff origin/dev --stat` lists it; other people's merged files are not in it.
- The plan, with your plan review's findings and how each was answered:
  `docs/plans/261004g-overseer-report-drain-artefact-checks-stop-blocking-the-daemon.md`
  (§ What the plan review changed). Your plan review: `docs/plans/261004g-report-drain-plan-review-sol.md`.
- Files: `tools/overseer/report-artefacts.ts`, `tools/overseer/reports.ts` (`drainSteps`,
  `drainReports`, `drainReportsAsync`), `tools/overseer/daemon.ts` (`guard`, `sourceStop`,
  `stillOwner`, `leaving`, the reports ticker, `settleInFlight`, `stopTimers`),
  `tools/overseer/store.ts` (`checkOwnership`), `scripts/overseer.ts` (`makeReportDrain`), and
  tests: `tests/overseer-daemon-reports.test.ts`, `tests/overseer-reports.test.ts` (the two new
  `makeArtefactChecker` tests; the describe "the awaited drain is the same pass…"),
  `tests/overseer-reports-cli.test.ts`, `tests/overseer-daemon.test.ts`,
  `tests/overseer-daemon-restart-no-double-dispatch.test.ts`,
  `tests/overseer-daemon-recovery.test.ts`, `tests/no-sync-child-in-long-running.test.ts`.

## Context

Orchestrator code, held to a higher bar than the rest of dev: it is what is reached for when
something else is broken. The daemon runs under systemd with `Restart=always`.

Also in this candidate, separately committed first: a one-line fix to a red test on dev
(`tests/overseer-daemon-reports.test.ts`, "the drain is called on its interval…"), whose stop
condition counted drains but asserted on a register that fills later.

## What to do

Independent pass first: trace the real paths. Then attack.

Grade by consequence: **P0** data loss, a second writer under a lock that is not ours, a daemon that
cannot stop or restart; **P1** wrong recorded state, or a contract violated; **P2** design or
maintainability; **P3** prose. Give each finding an ID continuing from your plan review (F6, F7, …),
a file:line, and *established* or *reasoned*. For each one say whether you fixed it, and the test
that was red. End with one line: `VERDICT: land` / `VERDICT: land after fixes (made)` /
`VERDICT: do not land`.

**Check my conclusions, not only my code.** The plan's log claims each test was seen red for the
stated reason. Pick the ones that matter most and break the code to see whether they do go red.

## My own suspicions (worth less than yours; spend most of the run elsewhere)

1. `sourceStop`: the source now gets the daemon's own signal. Is there any reader of
   `options.signal` that should now read `sourceStop.signal`, or the reverse? Does aborting the
   source from inside `guard` — which can be called from a timer, from the drain's driver, or from
   inside `takeProbed` in the main loop — re-enter anything? The outcome must still be `lock-lost`.
2. `leaving` is set in `stopTimers()`. Trace every exit: abort, source end, source throw, lock loss
   found by the heartbeat, lock loss found by the drain. On each, is the drain told to stop before
   `settleInFlight()` waits on it, and can `settleInFlight()` wait for ever on it?
3. The reports ticker's promise chain: can it reject unhandled (which would kill the process)?
   `write()` can throw if the note log is broken. Is `reportsRunning` always cleared?
4. `drainSteps`: after `"abandon"` it returns from inside a `try` inside two loops. Is anything
   left half-done at that point (the `outcome.probes` count, `files`, `inFlight`, a temp file)? Is
   `deferred` right? And F5: now that the code exists, is the generator still worse than a plain
   `async` function here? Say which you would keep and why; do not convert it.
5. `gitIn`'s mapping from `OwnedOutcome`. `stderr: outcome.why` feeds regexes in `checkCommit` and
   `checkPath`, and `clip()` of it is stored in a report's `why`. Anything in the owner's sentence
   (a pid, a path, the key) that should not be stored, or that makes a regex match wrongly?
   One shared key `reports:artefact-git`: after one timed-out git that will not die, every later
   reference is `refused` and so `unchecked` until it exits. Is that the right degradation, and is
   it recorded permanently on those reports (yes — checks are made once, at receipt)? Is that
   acceptable against the old behaviour (the daemon blocked instead)?
6. The lock-gone log line in `guard`: logged once? Could it throw (`now()`, `log()`), and if it
   did, would `stopped` still be set? Order matters there.
7. `tests/overseer-daemon-reports.test.ts` keeps three real 150 ms waits for "the daemon has NOT
   returned". Is there a condition they could wait on instead?
