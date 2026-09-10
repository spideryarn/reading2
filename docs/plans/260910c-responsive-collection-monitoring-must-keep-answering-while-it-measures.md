# Responsive collection — monitoring must keep answering while it measures

**Status: planning.** Dispatched by the Overseer as queue item `qi-n6seyeks`, from
[260908f-overseer-and-fleet-improvement-roadmap.md](260908f-overseer-and-fleet-improvement-roadmap.md)
§ "Stage: Responsive collection". That stage's six checkboxes and its acceptance paragraph are the
spec; this doc is how they get built and what got measured.

## What is wrong, stated as a mechanism

The fleet dashboard is one Node process. It serves `/api/state` from module-level variables —
`snapshot`, `health`, `lastError`, `attemptedAt` — so the *data* is already cached and the answer is
a `JSON.stringify` away. That is not what makes the page slow. What makes it slow is that the same
process, on the same thread, runs the collection with **synchronous child processes**, and a
synchronous child process stops the event loop for its whole duration. While `execFileSync` is
waiting, the HTTP server accepts nothing, parses nothing and writes nothing. A cached answer behind
a blocked loop is not a cached answer.

The blocking calls, in the order one turn of `refreshOnce` makes them:

| Where | Call | Timeout | Cost seen | Blocks the loop |
|---|---|---|---|---|
| `collect.ts` `generationNow()` | `tmux display-message -p '#{pid}'` | 5 s | ms | yes |
| `collect.ts` (the inventory) | `bash -c sessionScript()` | 60 s | 8–12 s | **no** — already `promisify(execFile)` |
| `collect.ts` `panes()` | `tmux list-panes -a` | 10 s | ms | yes |
| `collect.ts` `readPanes()` | `tmux capture-pane` × one per eligible row | 10 s each | ~9 ms each | yes |
| `collect.ts` `readExecutions()` | `ps` × 2 (`tools/overseer/work-probe.ts`) + one `/proc/<pid>/stat` per harness | 10 s | 236 ms over 26 sessions | yes |
| `health.ts` `collectHealth()` | `uptime`, `nproc`, `free -b`, `swapon`, `df -k /`, **`vmstat 1 2`**, `ps -eo rss,args` | 5 s each | ~1.1 s, almost all `vmstat` | yes |

So the *normal* case already stops the server for something over a second and a third of a second
per minute, and the *bad* case — the one this box actually has, a tmux that is slow because the
machine is swapping — stops it for up to 15 seconds on the two tmux calls alone before any pane is
captured. That is the shape of the acceptance sentence: **a fake 30-second probe must not hold
`/api/state` or health rendering open.** Today it holds both open for the full 30 seconds.

The second half of the stage is about what happens to the child when we stop waiting.
`collectWithDeadline` abandons the *caller* and leaves the child running with nothing owning it, and
`singleFlightCollect` (landed 2026-09-08) bounds the number of such orphans at one for the inventory
only. Every other probe here has no owner at all: `execFileSync`'s `timeout` sends `SIGTERM` and, if
the child is in uninterruptible I/O, returns while the child stays alive — and nothing anywhere
observes its exit, counts it, or refuses to start another one.

### What we are *not* claiming

No speed improvement is claimed anywhere in this plan without before/after output from
`scripts/fleet-collect-bench.ts` pasted into the stage's status paragraph. The "12-second grepping"
in the roadmap is context from a source comment, not a benchmark, and the 236 ms above is a figure
another session measured on 26 sessions on one day — both get re-measured here before anything moves.

## The simpler option we are not taking

**A worker thread, or a second process, for collection.** It would remove every blocking call from
the request path in one move and need none of the async conversions below. It is rejected for this
stage: the collection reaches module state (`snapshot`, `health`), the routes, the drain and the
health-history writer's single-writer lock, so moving it off-thread means designing a serialisation
boundary for all of that, and the health-history lock in particular is built on there being one
writer process. Against that, the conversions below are mechanical, individually testable and leave
the process topology alone — `vision.md` § Simpler first. If, after this stage, the residual
blocking is still material, the worker-thread move is the next thing to weigh, and it will be
weighed against a measurement rather than a guess.

**Also rejected: `execFileSync` with a shorter timeout.** It makes the bad case less bad and the
normal case no better, and it does not touch the ownership half at all.

---

## Stage 0 — Measure, before anything moves

Build `scripts/fleet-collect-bench.ts` and record the baseline. Nothing else in this plan may
start until its output is in this file.

- [x] **The instrument.** One script, two modes.
  - `--mode=real`: run the real `collect()` and the real `collectHealth()` N times against this
    box, timing each phase separately, and record the number of live sessions and the total size
    of the transcripts the inventory greps, so the numbers can be read a month from now.
  - `--mode=fixture --sessions=N --slow-probe-ms=M`: the same passes driven by injected fakes —
    `readPanes(rows, capture)` and `ExecutionIo` already take their probes as parameters — with one
    probe that sleeps `M` ms. This is the controlled fixture the 250 ms p95 is quoted against.
- [x] **The latency measurement is a real HTTP request from another process.** An in-process client
  cannot measure a blocked event loop, because it is blocked too. The bench binds an ephemeral port
  with a handler that does what `server.ts` does for `/api/state` — `res.end(cachedString)` — forks
  a child that requests it every 25 ms and writes each latency to a file, then runs the passes.
  Report median, p95 and max.
- [x] **And event-loop lag beside it**, from a 5 ms `setInterval` measuring its own drift. It is the
  same fact seen from inside, and having both means a surprising HTTP number can be checked against
  something that shares none of its machinery — `docs/reusable/silent-success.md`.
- [x] **Record: date, box load average at the time, session count, fixture size, the exact command.**

**Acceptance:** a baseline table in this file, produced by a command anybody can re-run.

## Stage 1 — Owned children: a probe you can stop waiting for and still be responsible for

New module `tools/fleet/child.ts`. Nothing in it knows about fleet, health or panes.

- [ ] **`runOwned(spec)`** — `spawn` (not `execFile`), stdout collected under a byte cap, and a
  lifecycle that is a *state machine with an observed exit*, not a timeout:
  `running → (deadline) → SIGTERM → (grace) → SIGKILL → (grace) → stuck`. It resolves with a
  discriminated union — `ok` / `failed` / `timed-out` (signalled **and** exit observed) /
  `stuck` (signalled, both graces elapsed, `close` never fired) — so "we killed it" and "it would
  not die" are different answers, which is the whole point of the checkbox.
- [ ] **`stuck` carries the pid and the child stays registered as live.** `owner.live()` lists them.
  A `stuck` child is a *degraded* reading, never a retry: the next call for the same probe key
  refuses to spawn a sibling and returns `blocked-by-stuck` with how long it has been there. That
  is `singleFlightCollect`'s rule generalised from the inventory to every probe, and it is what
  "repeated timeouts do not multiply live owned children" means.
- [ ] **The group kill has to prove the group is ours.** Children are spawned `detached: true`, which
  makes the child a process-group leader, and before any `process.kill(-pid, …)` we read
  `/proc/<pid>/stat` field 5 and require `pgrp === pid`. If we cannot prove it, we signal the pid
  alone and say so in the `why` — a `bash -c` whose greps survive is a worse outcome than a
  group kill, but killing a group we did not create is worse than both. The ideas come from
  `scripts/subagent-cli.ts` (SIGTERM → grace → SIGKILL on the group, one deadline not two); **its
  code is not imported and its product dependencies do not come into fleet.**
- [ ] **`limit(n)`** — a small concurrency limiter in the same module, so the cheap independent
  probes run a few at a time rather than one child per session at once.
- [ ] **Tests, red first**, driven by a fake spawn: a child that exits cleanly; one that exits
  non-zero; one that ignores SIGTERM and dies on SIGKILL (→ `timed-out`); one that ignores both
  (→ `stuck`, pid recorded, second call refused); one whose `/proc` says it is not its own group
  leader (→ pid-only signal, and the `why` says so); a limiter that never exceeds `n` in flight.

## Stage 2 — Health off the request thread

- [ ] **Split the assembly from the gathering.** Everything above `run()` in `health.ts` is already
  pure. Add `assembleHealth(reads)` taking the seven command outcomes and returning the
  `HealthReport` — one place that decides what the readings mean, unchanged.
- [ ] **`collectHealthAsync(owner, options)`** gathers through `runOwned` with `limit(3)` for the six
  cheap commands, and `vmstat 1 2` on its own longer bound, all concurrently. **The existing
  synchronous `collectHealth` stays, calling the same `assembleHealth`** — `routes-new.ts` and
  `scripts/readiness-loop.ts` are other people's files and keep working untouched.
- [ ] **Health failure stays separate from fleet failure**, which `refreshOnce` already does; and a
  probe that returns `stuck` becomes that field's `unknown` with the pid and duration in the `why`,
  not a zero. **Swap's since-boot first sample stays excluded** — `parseSwapActivity` discards it
  and a test pins that it still does.
- [ ] `RefreshDeps.refreshHealth` becomes `() => Promise<HealthTurn>`; `server.ts` awaits it. Both
  files are the composition of this loop and are named in the plan as in scope.

## Stage 3 — The tmux probes, and the pane pass

- [ ] `capturePaneAsync` beside `capturePane` in `pane.ts` (the sync one stays: `steer.ts` uses it
  and is not ours), and `readPanes` becomes async over `limit(4)`.
- [ ] `panes()` and `generationNow()` in `collect.ts` go through the owner. Their existing
  bargains do not change: an unreadable listing is an empty map, an unreadable generation is `null`
  meaning *unverifiable*, and only two numbers that disagree are drift.
- [ ] **Per-field unknowns are preserved**, and each one now says which kind of not-looking it was —
  a pane we did not reach because the probe was refused behind a stuck child reads differently from
  a pane whose capture failed.
- [ ] **Publish attempted / failed / last-good even when a probe cannot complete.** `attemptedAt`,
  `lastError` and the retained previous `snapshot` already carry this for the collection as a whole;
  this stage adds the per-probe counterpart to the payload so the page can say *the pane pass was
  attempted, three of twenty-two captures failed, and one child is stuck*.
- [ ] Re-run the bench. Before/after in this file, or no claim.

## Stage 4 — `readExecutions`, and the title grep

Both are *cost* rather than *responsiveness*, and both cross a file boundary, so they come last and
each is decided on Stage 0's numbers.

- [ ] **`readExecutions`' two `ps` calls** are 236 ms of blocked loop on somebody else's
  measurement. Making them async needs the validation inside `probeProcessTable`
  (`tools/overseer/work-probe.ts`) to be reachable from an already-fetched stdout — a pure
  extraction of about fifteen lines, in a file this brief says is not ours. **Ask the Overseer
  before editing it**; if the answer is no, the pass stays synchronous and is recorded here as
  remaining work with its measured cost.
- [ ] **The title lookup in `buildSessionScript`** greps whole multi-MB transcripts, once per live
  session, and a source comment calls it the dominant cost of a whole collection. Bound it with an
  **incremental cache keyed on identity + size**: a file never seen is read once, a file that has
  grown is read only over its new bytes, a file unchanged keeps its previous answer. **A title
  absent from the new bytes is previous-known, never a removal**, which is also why a plain
  `tail -c` is wrong: Claude titles a conversation early, so a tail would systematically report
  every long session as untitled. Pinned manual names, provisional-name semantics, transcript
  relocation and re-titling all keep working, each with a test.

---

## Measurements

The instrument is `scripts/fleet-collect-bench.ts`. Every number below is its output, and nothing
above may be claimed as an improvement without a *before* and an *after* here.

### Baseline, 2026-09-10, before any change

Box: the Hetzner box, 16 cores, load average 5.4–6.0 at the time, 25 tmux sessions with a pane,
326 transcript files totalling 1.11 GB under `~/.claude/projects/`. Node v26.8.1.

**Two instruments that share no machinery agree**, which is why the numbers are believable: HTTP
latency measured by a *separate process* polling an ephemeral-port server at 40 requests a second,
and event-loop lag measured inside the process by a 5 ms interval recording its own drift.

`npx tsx scripts/fleet-collect-bench.ts --mode=real --runs=2`

| phase | wall | loop lag p95 | loop lag max |
|---|---|---|---|
| `bash -c sessionScript()` — **already async** | 5130 / 4981 ms | 0.7 / 0.6 ms | 7.8 / 4.7 ms |
| `tmux display-message` [sync] | 12 / 19 ms | 7.7 / 15.3 ms | 7.7 / 15.3 ms |
| `tmux list-panes -a` [sync] | 11 / 18 ms | 6.2 / 13.4 ms | 6.2 / 13.4 ms |
| `tmux capture-pane` × 25 panes [sync] | **299 / 342 ms** | 296 / 337 ms | 296 / 337 ms |
| `ps` × 2, `readExecutions`' probe [sync] | **197 / 186 ms** | 192 / 181 ms | 192 / 181 ms |
| `collectHealth({includeSwapActivity:true})` [sync] | **1184 / 1162 ms** | 1180 / 1157 ms | 1180 / 1157 ms |
| `collectHealth({includeSwapActivity:false})` [sync] | 124 / 146 ms | 121 / 142 ms | 121 / 142 ms |
| `collect()` end to end, 25 rows | 5677 / 6096 ms | 0.6 / 0.6 ms | **478 / 467 ms** |

`/api/state` over the whole run, 1058 requests: median **1.9 ms**, p95 **530 ms**, max **1167 ms**.

`npx tsx scripts/fleet-collect-bench.ts --mode=fixture --sessions=25 --probe-ms=30000` — the
acceptance case, on the controlled fixture:

| phase | wall | loop lag max |
|---|---|---|
| `readPanes` over 25 rows, every capture a real child | 216 ms | 213 ms |
| `readPanes` over 25 rows, **one capture sleeps 30 s** | 30012 ms | 30008 ms |

`/api/state` during it, 641 requests: median **22083 ms**, p95 **29223 ms**, max **30003 ms**.

### What the baseline changes about the plan

- **The acceptance case is real and total.** A 30-second probe holds `/api/state` open for the full
  thirty seconds — not degraded, *shut*. The target is p95 under 250 ms on this same fixture.
- **`collectHealth` is the single largest blocker, at ~1.17 s per turn**, and almost all of it is
  `vmstat 1 2` (the same call without it is ~135 ms). Stage 2 is therefore worth more than Stage 3
  on the normal case, and Stage 3 is worth more on the bad case, because the tmux calls are the ones
  whose timeouts are 5 and 10 seconds.
- **`collect()`'s own sync tail is one ~470 ms block** — the pane captures and the two `ps` calls run
  back to back with nothing awaited between them, so they are a single hole in the event loop rather
  than two.
- **The inventory is 5.0 s, not the 10–12 s a source comment in `gjd-remote-tmux.ts` claims**, and it
  is already async, so it costs *freshness* and no responsiveness at all. That downgrades Stage 4's
  title-grep work from "the dominant cost" to "a second of staleness", and it is the reason Stage 4
  now ranks below the rest rather than beside it. The 10–12 s figure was measured through `ssh` by
  `gjd-remote ls`; this is the same script run locally by `bash`.
- **The real-box p95 of 530 ms is already over the 250 ms target** before any fake probe is
  involved, so the target is not slack.
