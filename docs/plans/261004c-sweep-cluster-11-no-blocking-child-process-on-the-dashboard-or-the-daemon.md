# Sweep cluster 11: no blocking child process on the dashboard or the daemon

Cluster 11 of the [fifth codebase sweep](261003f-fifth-codebase-sweep-umbrella.md) (items DF-F3 —
the guard and the read-only probes — KN-G1, DF-F4, KN-G2). Orchestrator tier: the fleet dashboard
and the Overseer daemon, so each change is small and proved by a test.

## What is wrong

A synchronous child call (`execFileSync`, `spawnSync`) with a `timeout` does not stop waiting at the
timeout. It sends a signal and then waits for the child to exit, however long that takes
([postmortem 260910a](../postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md)).
The dashboard server and the Overseer daemon each have one thread, so a stalled `ps`, `tmux` or
`git` freezes the whole process — on a struggling box, which is when both are needed. The fix,
`probeOwner().run()` in `tools/fleet/child.ts` (an owned asynchronous child the caller stops waiting
for at `timeout + grace`), reached the collection path and not its siblings. Nothing stops a new
synchronous call being added.

## The census, re-run on 2026-10-04 at `ab8289e2`

`grep -rnE "\b(execFileSync|spawnSync|execSync)\b" tools scripts/overseer.ts`, call sites only. It
matches the audit's 18 under `tools/`, plus one in `scripts/overseer.ts`:

| File | Calls | Reached from | This plan |
|---|---:|---|---|
| `tools/fleet/routes-actions.ts` `listProcesses` | 2 | request (box actions) | convert — stage 2 |
| `tools/overseer/usage.ts` `runAuthStatus` | 1 | daemon usage pass | convert — stage 2 |
| `tools/fleet/health.ts` `run` (via `routes-new.ts` `healthLevel`) | 1 | request (new session) | route converts — stage 2; the sync `collectHealth` stays for `cli-tick.ts` and two scripts |
| `tools/fleet/routes-rename.ts` | 2 | request (rename) | convert — stage 2 |
| `tools/overseer/work-probe.ts` `probeProcessTable` | 1 | daemon, every admitted snapshot | daemon converts — stage 3; the sync one stays for the bench script, with KN-G2's reorder |
| `tools/overseer/report-artefacts.ts` `gitIn` | 1 | daemon report drain | convert — stage 3 |
| `tools/fleet/readiness-wiring.ts` `liveSessionNames` | 1 | dashboard readiness timer | convert — stage 4 |
| `tools/fleet/readiness-git.ts` `git`, `relate` | 2 | the same timer; also `scripts/readiness-{run,loop}.ts` | stage 4, see the open call below |
| `tools/overseer/attention-probe.ts` | 2 | `attention-cli.ts` — header says CLI only; **to verify** (`attention-cli.ts` passes `seams.listSessions()` into `runAttentionPass`) | convert if the daemon reaches it, else stays listed with the reason |
| `tools/fleet/steer.ts`, `pane.ts` | 2 | every send | **not here** — cluster 23 (steering needs per-pane serialisation) |
| `tools/fleet/revision.ts` | 1 | startup only | stays listed |
| `tools/overseer/diagnose.ts`, `launchers.ts` | 2 | CLI | stays listed |
| `scripts/overseer.ts` (tmux session lookup) | 1 | report CLI | stays listed |

## Stages

Each ends green and committed. Each defect gets a failing test first, seen red.

### Stage 1 — the guard, KN-G2, and the false comments

- **The guard (KN-G1).** A new test, `tests/no-sync-child-in-long-running.test.ts`: a flat scan of
  every `.ts` file under `tools/` (not `tools/fleet/web/`) plus `scripts/overseer.ts`, with Babel,
  for a **value** import of `execFileSync | spawnSync | execSync` from `node:child_process` (or
  `child_process`), including a namespace or default import of the module. The result must equal a
  literal list of today's files, each with a one-line reason. Equal, not subset: a new file fails,
  and a file that stopped importing one fails too until its line is deleted, so the list only
  shrinks. The walker is self-checked first (it finds a value import, ignores a type-only one),
  as `tests/fleet-imports.test.ts` does. **Simpler option passed over:** adding it to
  `fleet-imports.test.ts` — that file is about one seam (the send transport) and is already 526
  lines; and the import-graph walk both investigation docs proposed, which the umbrella rejected
  because "this file is CLI-only" is the claim that goes stale.
  Red first: the test is written with an empty list and seen to name all the files.
- **KN-G2.** In `work-probe.ts`, check `run.signal` before `run.error`, so a timed-out `ps` says
  *"killed by SIGTERM after N ms (timeout is …)"* with the measured clock. Test: a real child that
  ignores TERM for ~1.5 s with the timeout injected at 200 ms (a new optional `timeoutMs`), asserting
  the message quotes a clock over 1000 ms. Red first against today's order.
- **False comments.** `drain.ts` "~60 seconds of worst case" (twice) and `health.ts` "the 5s
  timeout", `work-probe.ts` "short enough that a tick does not wedge": each reworded to say the
  timeout is when the signal is sent, not a bound, with a pointer to the postmortem. Comment only.

### Stage 2 — the conversions whose caller already awaits

One site at a time, each with a test that injects a `ProbeOwner` whose child ignores TERM (the
`tests/fleet-child.test.ts` template) or a fake owner, and asserts the outcome mapping.

- `routes-actions.ts` `listProcesses`: already returns a promise; the two `ps` calls go through an
  owner (keys `actions-ps-args`, `actions-ps-comm`). Refused / timed-out / overflowed all become
  `{ ok: false, why }`, as a thrown error does today.
- `usage.ts` `runAuthStatus`: `collectUsage` is already async.
- `routes-new.ts` `healthLevel`: the dependency becomes `() => Promise<HealthLevel>` and the real one
  calls `collectHealthAsync` without the vmstat sample. A collection that throws or is refused must
  read as `unknown`, which the gate already refuses.
- `routes-rename.ts` `RenameIo`: both methods return promises; the handler is already async.
  `rename-session` changes state, so on `timed-out` the answer is the existing `rename-failed` with
  a sentence that says the rename **may** have happened — the page re-reads names on its next
  refresh. (Today a timeout says the same thing less honestly.)

**Where the owner comes from.** `server.ts` already makes one (`fleetProbeOwner`). Rather than thread
it through four composition functions, each converted module takes an optional `owner` in its
existing `real…()` factory and defaults to a module-level `probeOwner()`. Keys are distinct per
probe, so separate owners refuse exactly what one shared owner would. *Named trade-off:* several
owners each attach a SIGINT/SIGTERM forwarder while a child is live; that is already how
`fleet-collect-bench.ts` uses it. If Sol prefers one shared owner, the cost is a small edit to
`server.ts` at each composition.

### Stage 3 — the daemon

- **work-probe.** `daemon.ts` `probe` option becomes `() => ProcessTableReading |
  Promise<ProcessTableReading>`, awaited; the default becomes the owned async probe. This needs the
  call site (`take`, a sync function called per snapshot) to be able to await — **to be sized before
  building**: if `take` cannot become async without reordering the fold, this item stops at the
  guard's exception line and is reported, not forced. `probeProcessTableAsync` lives in
  `tools/fleet/collect.ts` today; it moves beside the parser in `work-probe.ts` (the invariant's
  home) and `collect.ts` imports it.
- **report-artefacts.** `ArtefactChecker` becomes async, `drainReports` becomes async, and the
  daemon's `reportsTicker` gets an in-flight flag so a slow pass is skipped over, not overlapped.
  Same caveat: sized first; reported rather than forced if the ripple is wide.
- **attention-probe**, if the verification above says the daemon reaches it.

Files outside the umbrella's list that this stage must touch, minimally: `tools/overseer/daemon.ts`,
`tools/overseer/reports.ts`, `scripts/overseer.ts`, `tools/fleet/collect.ts`. No other cluster in the
umbrella names them.

### Stage 4 — the readiness timer

`liveSessionNames` becomes async through the owner, `ReadinessRetention.collect()` becomes async,
and `server.ts`'s `refreshReadiness` awaits it with an in-flight flag. **Open call for
`readiness-git.ts`:** its `git()` is shared with two scripts that are short-lived or block only
themselves. Converting it for the dashboard means an async twin beside the sync one — two ways to
do one thing. Proposal: add `snapshotDevAsync` and an async `relate` built on one shared
argument-and-parse layer, so only the spawn differs; if that comes to more than ~100 lines, leave
`readiness-git.ts` on the exception list with the reason and say so in the umbrella.

### Stage 5 — daemon tests that sleep (DF-F4)

In `tests/overseer-daemon.test.ts`, `-ordering`, `-restart-no-double-dispatch` and `-recovery`: the
**negative** assertions first (a `sleep(40)` followed by "nothing was dispatched" passes if no tick
ran). Each becomes: count scheduling opportunities with `ticks(root)` / `tickAfter(root)` from
`tests/helpers/overseer-until.ts`, wait until at least N more have happened, then assert. The
restart file's private `waitFor` is replaced by the shared `until`. Positive fixed waits become
`until(condition)`. Proof each can fail: mutate the daemon (or the assertion's subject) so the thing
does happen and see the test go red. Sleeps that are the *subject* (a slow fake that must take real
time) stay, with a comment.

## Done

- The guard is in `npm test`, and its list is shorter at the end than at stage 1.
- Every converted site has a test that was red first.
- `npm test`, `npm run typecheck` green; lint on touched files.
- The umbrella row says what landed, with commits, and what stays on the list and why.
- **Nothing is restarted by this work.** The dashboard and the daemon pick the changes up at their
  next restart, which is the Overseer's to do.

## Not doing

- Steering (`steer.ts`, `pane.ts`, `drain.ts` logic) — cluster 23.
- `scripts/` sync calls other than `scripts/overseer.ts` — CLI, outside the long-running processes.
- A Biome `noRestrictedImports` rule — lint is advice here, not a gate (260910a's own conclusion).

## Log

- 2026-10-04 — plan written; census re-run.

---

Up: [261003f-fifth-codebase-sweep-umbrella.md](261003f-fifth-codebase-sweep-umbrella.md)
