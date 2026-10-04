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

### After GPT Sol's plan review (2026-10-04) — what changed

[The review](261004c-review-1-gpt-sol-on-the-plan.md) said BUILD WITH CHANGES, nine findings. Each
was checked against the code; all nine are accepted.

- **F1** (reordering does not fix KN-G2): confirmed by my own red test before the review landed. A
  child that ignores TERM comes back with `signal: null`, so the fix keys on `ETIMEDOUT` and quotes
  the measured clock in both cases.
- **F2, F7** (health admission): a partly refused survey reads `ok`, and separate owners are not
  equivalent because the keys are shared. **So new-session admission stops collecting at all.** It
  reads the server's own per-minute health snapshot, and answers `unknown` when there is none or it
  is older than three refresh intervals. No child in the request, no key collision, and one owner
  per process: `processProbeOwner()` in `child.ts`, which `server.ts` now uses.
  *Trade-off, named:* the gate sees a reading up to a minute old instead of a fresh one.
- **F3** (work-probe in the daemon): the probe moves to the **front** of `take`, before anything is
  published, so the fold after it stays one synchronous stretch.
- **F4** (report drain): more than an adapter — the drain's promise must be held and settled on
  both exit paths, and ownership rechecked after each await. Its own stage, last, and dropped to the
  exception list if it cannot be made small.
- **F5** (daemon tests): heartbeat ticks are not scheduler opportunities. Negative assertions count
  the callback they are about.
- **F6** (guard): the scan already covers `require`, dynamic `import()` and re-exports; its header
  now says what a file list cannot prove.
- **F8**: no async `relate` — nothing on the dashboard calls it.
- **F9**: the async `snapshotDev` resolves refs to shas first and counts from the shas.
- `attention-probe.ts`'s "the daemon does not use this" is false (`attentionRunner` in
  `scripts/overseer.ts`). It is converted, and the header corrected.

### Stage 2 — dashboard request paths

One site at a time, each red first. Every converted site uses `processProbeOwner()` by default,
takes an injectable owner for tests, and says what `refused` means there.

- `routes-actions.ts` `listProcesses`: the two `ps` calls through the owner. Refused, timed-out and
  overflowed all become `{ ok: false, why }`, as a thrown error does today.
- `routes-new.ts` `healthLevel`: as F2/F7 above. The dependency becomes a read of a snapshot the
  server supplies (`configureNewSessionHealth`, beside the existing `configureNewSessionNotifier`);
  unconfigured answers `unknown`, which the gate refuses — loud, not open.
- `routes-rename.ts`: both tmux calls through the owner, and **one rename at a time** (a second
  request while one is in flight gets the existing 409), because list → check → rename is no longer
  one synchronous stretch. A timed-out `rename-session` says the rename may have happened.
- `usage.ts` `runAuthStatus`: `collectUsage` is already async and the daemon already prevents
  overlapping passes.

### Stage 3 — the daemon's probes

- **work-probe** (F3). `probeProcessTableAsync` moves from `collect.ts` to `work-probe.ts`.
- **attention-probe**: `listSessions` and `tmuxServerGeneration` async; the generation is read
  before and after the listing, and a pass whose generation moved carries no old waits forward.

### Stage 4 — the readiness timer

`liveSessionNames` and `snapshotDev` (F9) async; `collect()` async; `server.ts` latches before the
first await and clears in `finally`, publishing only a completed snapshot. It does not run inside
the main refresh turn, so it cannot delay a fleet refresh. `readiness-git.ts` keeps its sync
functions for the two scripts, sharing the argument and parse layer.

### Stage 5 — daemon tests that sleep (DF-F4, with F5)

The **negative** assertions first, in `tests/overseer-daemon-restart-no-double-dispatch.test.ts`:
each waits until the jobs callback has demonstrably run N more times (counted at the injected seam
it already has), then asserts nothing was dispatched. Proof it can fail: disable the dedup and see
red; and stop the callback and see the *wait* fail rather than the assertion pass. Positive fixed
waits in the other three files become `until(condition)`. Post-shutdown "nothing runs after stop"
assertions keep a real wait, with a comment saying why no counter exists there.

### Stage 6 — the report drain (F4)

Only if it stays small. Otherwise `report-artefacts.ts` stays on the list and the umbrella says so.

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
- 2026-10-04 — GPT Sol's plan review: build with changes; all nine findings accepted (above).
- 2026-10-04 — stage 1 built: the guard (seen red both ways by swapping one list entry), KN-G2
  (red: "could not be run: … ETIMEDOUT" with no clock), four false comments, `processProbeOwner()`.
- 2026-10-04 — stages 2–4 built by four Opus subagents on disjoint files, each site red first
  against a child that ignores TERM (the old calls held 3–12 s against 200 ms timeouts):
  `routes-actions.ts`, `usage.ts`, `routes-rename.ts` (plus one rename at a time), `routes-new.ts`
  (reads the server's snapshot), `readiness-wiring.ts`, `readiness-git.ts` (`snapshotDevAsync`,
  counts from pinned shas; the sync functions stay for the two scripts, so the file stays listed),
  `attention-probe.ts`, and the daemon's process-table probe. The guard's list went from 15 to 10.
  - The daemon probe did not need to stop: the await sits in a new `takeProbed`, before `take` has
    changed anything, and `take` itself is still one synchronous stretch.
  - The health snapshot's "too old" is the loop's own longest gap (the failure backoff plus two
    intervals), not a flat three intervals, which would have refused launches during every backoff.
  - **Left, and known:** the daemon's attention pass still calls the synchronous `capturePane` once
    per session (`pane.ts`, cluster 23), so that pass can still wedge the daemon.
- 2026-10-04 — [GPT Sol's code review](261004c-review-2-gpt-sol-on-the-code.md) of stages 1–4: land
  after fixes. It fixed four things itself, each red first (F10 a partly unreadable health reading
  admitted a launch; F11 two unproven tmux generations in a row carried waits; F12 the guard missed
  `import x = require(...)`; F13 an abort during the probe still asked the source for another
  payload), and wrote three postmortems. `7c1544ca5`.
- 2026-10-04 — stage 5: 33 sleeps converted in the four daemon test files, five kept with a comment
  each. `b7e4848f3`. **Two cannot be converted without a daemon change:** "the heartbeat noticed the
  lock was gone" has nothing to observe (the guard stops silently). A log line there would do it.
- 2026-10-04 — **stage 6 not built, by decision.** Sol's F4 is right that an async report drain is
  more than an adapter: the drain's promise has to be held and settled on both exit paths before the
  store is released, and ownership rechecked after each awaited git call, with suspended-drain tests
  for shutdown, a throwing source and lock loss. That is a job of its own on the daemon, not the tail
  of a sweep cluster. `report-artefacts.ts` stays on the guard's list with that reason. Its exposure
  is small meanwhile: a 2 s timeout, and the drain's own wall-clock limit between references.
- 2026-10-04 — [round two](261004c-review-3-gpt-sol-round-two.md): **LAND**, no changes. F10–F13
  hold; the stage 5 claims hold; one prose finding (F15, the pass-counter comment overstated), fixed.
  Discovery is closed.

## What is left on the guard's list, and why

Ten files. Cluster 23's: `steer.ts`, `pane.ts`. A job of its own: `report-artefacts.ts`. Kept
synchronous for a script or a CLI, with the long-running caller moved off it: `health.ts`,
`readiness-git.ts`, `work-probe.ts`. Startup or CLI only: `revision.ts`, `diagnose.ts`,
`launchers.ts`, `scripts/overseer.ts`.

---

Up: [261003f-fifth-codebase-sweep-umbrella.md](261003f-fifth-codebase-sweep-umbrella.md)
