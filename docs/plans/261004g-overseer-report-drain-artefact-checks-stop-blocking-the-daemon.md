# The Overseer's report drain checks git without blocking the daemon

Queue item `qi-xr3ard3z`. Parent: [261004c](261004c-sweep-cluster-11-no-blocking-child-process-on-the-dashboard-or-the-daemon.md)
(its stage 6, not built there by decision), under the
[fifth sweep umbrella](261003f-fifth-codebase-sweep-umbrella.md), cluster 11.

## What is wrong

`tools/overseer/report-artefacts.ts` runs `git` with `execFileSync` (2 s timeout) inside the daemon's
report drain. While git runs, the daemon's one thread does nothing else: no heartbeat, no fold of a
payload. `execFileSync`'s timeout sends one SIGTERM and then waits, so a git that ignores it holds
the daemon for as long as it likes. It is the last blocking child the daemon itself starts (the
attention pass's `capturePane` is cluster 23's).

Two smaller things ride along, both named by the queue item:

- The daemon says nothing when a write finds the lock gone; it just stops. Two daemon tests keep a
  fixed `sleep(40)` for that reason (261004c's log, stage 5).
- The umbrella's cluster 23 row does not name `pane.ts`'s synchronous `capturePane`, which the
  daemon's attention pass still calls.

## The design

Three small parts. Orchestrator code, so each is proven by a test seen red first.

### 1. The checker asks git through the owned child

`gitIn` calls `processProbeOwner().run({ key: "reports:artefact-git", cmd: "git", … timeoutMs: 2000 })`
(`tools/fleet/child.ts`, the same owner every other cluster-11 site uses). `makeArtefactChecker`
returns `(ref) => Promise<ArtefactCheck>`. The mapping keeps today's three answers:

| owner's outcome | `GitResult` |
|---|---|
| `ok` | `ok` |
| `failed`, a numeric exit code, no signal | `no`, with the owner's `why` as the text the stderr regexes read (it ends with git's stderr, untruncated) |
| anything else (`timed-out`, `refused`, `overflowed`, could not start, killed by a signal) | `could-not-run`, with the owner's sentence |

So *could not look* still never becomes *not there*. `refused` is new and honest: an earlier git
has not exited, so no second one is started, and the reference is `unchecked` saying so. The drain
makes one check at a time, so one key is the whole exclusion. The file leaves the guard's list in
`tests/no-sync-child-in-long-running.test.ts`.

### 2. The drain has one place it waits, and it is told when to give up there

`drainReports` is 320 lines of careful, synchronous, crash-ordered file work with **exactly one**
call out: `options.checkArtefact(ref)`. Nothing has been written for the current report when that
call is made (its `report-processing/` file comes after all its checks).

So the body becomes a generator, `drainSteps`, that `yield`s the reference where it used to call
the checker, and is sent back either the check or `"abandon"`:

```
drainSteps(options)   : Generator<ArtefactRef, ReportDrainOutcome, ArtefactCheck | "abandon">
drainReports(options) : the synchronous driver — unchanged signature, a synchronous checker
drainReportsAsync(…)  : awaits an async checker; after EVERY await asks stillOwner();
                        if false, sends "abandon"
```

On `"abandon"` the body stops the pass before writing anything for that report: `stoppedBy:
"abandoned"`, the report and everything after it counted `deferred`, the inbox file left where it
is for the next daemon. A checker that rejects is thrown into the generator at the yield, so it
lands in the same `catch` a synchronous throw does today (pending, next pass).

Everything else in the drain stays one synchronous stretch per report, exactly as now.

**The simpler option passed over:** make `drainReports` itself `async`. Same single await, but
every one of ~75 synchronous test calls gains an `await`, and nothing in the type says there is only
one suspension point. The generator keeps those tests byte-for-byte as the proof the body did not
change, and makes "one place it can be suspended" a fact of the signature. Cost: two drivers of
about ten lines each.

### 3. The daemon holds the drain's promise

`reports.drain` becomes `(register, stillOwner) => Promise<ReportDrainOutcome>`.

- `reportsRunning: Promise<void> | null`, the same shape as `usageRunning`. A tick that finds one
  running starts no second.
- `stillOwner` is `halted() === null && !signal.aborted && guard(store.checkOwnership())`.
  `checkOwnership()` is the store's existing private `ownership()` (one `stat`) made public as a
  result. So lock loss is noticed by the drain itself after each git call, not only at the next
  30 s heartbeat, and noticing it halts the daemon as any other refused write does.
- When it settles: nothing is written if `halted()` is set (the lock is somebody else's). On an
  ordinary stop the restore or degrade note is still written, because the lock is held until
  `settleInFlight()` returns.
- `settleInFlight()` awaits `reportsRunning`, so **both** exit paths (the normal one and the
  `catch` of a throwing source) wait for it before `stopHere` releases the store. The wait is
  bounded by one git call: 2 s, plus the owner's 1 s grace, then the abandon.

A drain that returns `stoppedBy: "abandoned"` is not logged as refused or pending; it is the daemon
stopping.

### 4. A line when the lock is found gone

`guard` logs once, at the moment it sets `lock-lost`: `the lock is gone (now held by …): stopping`.
The two `sleep(40)`s become `until(that line was logged)`.

### 5. Name `capturePane` in cluster 23

One sentence in the umbrella's cluster 23 row: `pane.ts`'s synchronous `capturePane` is also called
once per session by the daemon's attention pass, so cluster 23 is what stops that pass wedging the
daemon. And cluster 11's row loses `report-artefacts.ts` from "what stays".

## Tests, each red first

1. **Checker does not block.** A fake `git` (a script that ignores TERM and sleeps) as the binary;
   a 20 ms interval must tick while the check is awaited, and the answer is `unchecked`. Red today:
   the sync call lets no timer run. Existing `makeArtefactChecker` tests gain `await`.
2. **Async driver parity.** The same inbox through `drainReportsAsync` records the same lines as
   `drainReports`.
3. **Abandon writes nothing.** `stillOwner` goes false while a check is suspended: no
   `report-processing/` file, no line in `reports.jsonl`, the inbox file still there, `stoppedBy:
   "abandoned"`. An earlier report in the same pass, already committed, stays committed.
4. **A rejecting checker** leaves the report pending and the pass carries on.
5. **Daemon, shutdown:** abort while a drain is suspended; `runOverseer` must not resolve until the
   drain is released, and `stillOwner()` is false. Mutation proof: drop `reportsRunning` from
   `settleInFlight` and see red.
6. **Daemon, throwing source:** the same, on the `catch` path.
7. **Daemon, lock loss:** steal the lock while a drain is suspended; `stillOwner()` is false, the
   outcome is `lock-lost`, and no `reports` note is written afterwards.
8. **Daemon, no overlap:** a drain that outlasts several intervals was started once.
9. The two former sleeps, now waiting on the log line; red by removing the log line (the wait
   fails by name).

## Not doing

- Killing an in-flight git on shutdown. The owner has no cancel; 3 s is the bound.
- `capturePane` itself — cluster 23.
- Any change to what the drain records or to its limits.

## Done

`npm test` and `npm run typecheck` green; the guard's list one shorter; GPT Sol's plan review and
code review answered. **Nothing is restarted by this work**: the daemon picks it up at its next
restart, which is the Overseer's to do.

## What the plan review changed

[GPT Sol's review](261004g-report-drain-plan-review-sol.md): build with changes. Each finding checked against the
code; four accepted, one answered.

- **F1, accepted.** Setting `lock-lost` wakes nothing, and the main loop is usually parked in
  `source.next()`, which between payloads stays parked while the dashboard only pings. So a daemon
  that found its lock gone stopped writing and never returned. This predates the drain (the
  heartbeat had the same hole); the drain noticing lock loss made it reachable from one more place.
  The source is now given the daemon's own signal: the caller's, plus `guard` finding the lock gone.
- **F2, accepted.** A source that ends or throws aborts no signal, so `stillOwner()` stayed true and
  the drain went on recording through the settlement. `stopTimers()` now sets `leaving`, which
  `stillOwner()` reads; both ways out call it before they settle anything.
- **F3, accepted.** A commit is two git calls. The checker is handed the same `stillOwner` and asks
  it between them, so a daemon on its way out starts no second git.
- **F4, already so in the design above ("not logged as refused or pending") but said loosely.** An
  abandoned pass writes neither a restore nor a degrade. Tested with a degraded condition first.
- **F5, answered: the generator stays.** Sol would rather a plain `async` drain and the tests
  migrated. The reasons to keep it are the ones above: four changed lines in the crash-ordered body,
  and its 69 protocol tests untouched. Sol's three rules for the drivers are met and each has a
  test: the result of `throw()` is processed like any other step; only the checker's exception is
  caught, never the body's; ownership is asked after a rejection and before throwing it in. If the
  code review still prefers `async`, that is a mechanical follow-up, not a redesign.

## Log

- 2026-10-04 — plan written.
- 2026-10-04 — GPT Sol's plan review: build with changes (above).
- 2026-10-04 — built, each defect seen red first:
  - the checker against a `git` that ignores TERM held the thread for the script's whole 8 s; now
    released at the deadline, with the loop turning meanwhile;
  - five daemon tests red against the old ticker (a rejected drain ignored, eleven overlapping
    starts, two exits that did not wait, a stolen lock nobody noticed); F1 and F2 red before their
    fixes; the settle line and the abandoned-pass line each proven by removing them;
  - the awaited drain's tests proven by removing its ownership check (two go red);
  - the two `sleep(40)`s waited 20 s by name before the log line existed.
- 2026-10-04 — [GPT Sol's code review](261004g-report-drain-code-review-sol.md): **land after fixes (made)**.
  - **F6, fixed by Sol, red first:** the drain's last-resort log line could itself throw and reject
    the promise the shutdown waits on, so the store was never closed.
    [Postmortem](../postmortems/261004j-a-fallback-logger-rejects-the-promise-that-shutdown-must-settle.md).
    It notes the same unguarded fallback in the attention and recovery handlers; not touched here.
  - **F7, left, and not clearly a defect:** `stopHere()` writes the `daemon-stopped` note even
    after the lock is lost. That is on `dev` already, and looks deliberate: its `why` has a branch
    for exactly that case ("another Overseer took the lock"), and the note log is append-only and
    not the lock's. Reported to the Overseer as a question rather than changed.
  - Sol broke the code eight ways and each went red. It would keep the generator for now.
- **Restart needed:** the Overseer daemon, to pick any of this up. Not the dashboard.
