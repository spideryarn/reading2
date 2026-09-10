# A timeout that signals and then waits is not a bound

Every synchronous child process on the fleet dashboard's server carries a `timeout`, and every
comment near one treats it as the most that call can cost. It is not. At the deadline Node sends a
signal and then **goes on waiting for the child to exit**, however long that takes, and on a
single-threaded server that wait is the whole dashboard's. Found on 2026-09-10 by
[260910c](../plans/260910c-responsive-collection-monitoring-must-keep-answering-while-it-measures.md#and-the-timeouts-on-those-calls-do-not-bound-anything),
whose first draft claimed the opposite until GPT Sol contradicted it and a measurement settled it.
**Nothing reached a reader**: this is the operator's dashboard, not the product. No incident has been
traced to it. It stays hidden while the box is healthy and bites when the box is in trouble, which is
the only time the dashboard is needed.

## What happened

Re-measured for this file on the Hetzner box, 2026-09-10, Node v26.8.1, with a throwaway script:

```
execFileSync, child ignores TERM: timeout 1000 ms; came back after 20016 ms — threw: spawnSync sh ETIMEDOUT
spawnSync,    child ignores TERM: timeout 1000 ms; came back after 20010 ms — threw: spawnSync sh ETIMEDOUT
execFileSync, child obeys TERM:   timeout 1000 ms; came back after  1002 ms — threw: spawnSync sh ETIMEDOUT
```

The children were `sh -c 'trap "" TERM; sleep 20'` and `sh -c 'sleep 20'`. **The error is the same
in all three rows. Only the clock tells them apart.**

The plan's fixture puts one slow capture among 25 panes and shows what that costs the server: a
30-second probe held `/api/state` for its whole duration, at median 29050 ms and p95 29945 ms
(88 requests issued, 88 accounted for). The plan's
[Measurements](../plans/260910c-responsive-collection-monitoring-must-keep-answering-while-it-measures.md#measurements)
section has the table and the command.

## The class: a timeout that signals and then waits is not a bound

`execFileSync` and `spawnSync` cannot return until the child has been reaped. `timeout` does not
change that. It only chooses **when to send `killSignal`**, which is SIGTERM by default. So the
real worst case is *timeout + however long the child takes to die*, and the caller does not choose
the second term. A child can catch or ignore SIGTERM. A child in uninterruptible I/O generally
ignores even SIGKILL until the kernel lets it go, and on a swapping box that is exactly what `tmux`
and `ps` become. The error that finally arrives is `ETIMEDOUT`, which names the deadline and
implies it was enforced.

Stated so it can be used: **a bound is a caller that stops waiting at a time it chose. Anything that
only asks the child to stop is a signal.** A synchronous API cannot stop waiting, so no option passed
to it can bound it.

This is the floor under
[260906e](260906e-a-timeout-that-bounded-the-child-and-not-the-wrapper.md), *a wait that is bounded
for the thing you named and unbounded for the thing you meant*. There the child was bounded and the
wrapper was not. Here even the child is not bounded, and the caller is the server's only thread.

**And it has now been seen three times, and fixed only where each sighting happened:**

- **2026-09-06, `e8f00815`.** `scripts/subagent-cli.ts:12-13` says it outright: *"a real watchdog —
  SIGTERM → grace → SIGKILL … because `spawnSync`'s timeout blocks waiting for a child that may be
  ignoring the signal"*. The fix stayed in `scripts/`.
- **2026-09-08, `8f7de0fc`.** The same mechanism on the async inventory call:
  `execFile(…, { timeout: 60_000 })` against a bash in uninterruptible I/O, *"promisify(execFile) then
  waits for a process that is not coming back"*, and the refresh loop stopped for good. The fix raced
  the caller against a deadline. It left alone the synchronous calls in the same file, which have the
  same timeout and no race.
- **2026-09-10, this plan.**

## Which commits introduced it

In the collection path (line numbers as of `81817edd`):

| Site | Call, nominal timeout | Introduced |
|---|---|---|
| `tools/fleet/collect.ts:538` `panes()` | `tmux list-panes -a`, 10 s | `8215d60f` (2026-09-08), *"The page shows what a blocked session is asking"*, the first commit that needed pane ids |
| `tools/fleet/collect.ts:682` `generationNow()` | `tmux display-message`, 5 s | `0e0d6a8b` (2026-09-08), GPT Sol's F16 bracket, which reads the tmux generation before and after the inventory |
| `tools/fleet/pane.ts:1394` `capturePane` | `tmux capture-pane`, 10 s, one per blocked row | `8215d60f`, *"a capture is cheap"* |
| `tools/fleet/health.ts:582` `run()` | `uptime`, `nproc`, `free`, `swapon`, `df`, `vmstat 1 2`, `ps`, each 5 s | `8215d60f`, the commit that created `health.ts` |
| `tools/overseer/work-probe.ts:65` `probeProcessTable` | `spawnSync ps`, 10 s | `7166b92d` (2026-09-08), written for the Overseer. It reached the dashboard's process in `77d01268` (2026-09-09), whose comment in `collect.ts` names the event-loop block and calls it noise at ~40 ms. |

Before any of these there was `9e2e7b4f` (2026-09-08), v0.1, whose whole collection was
`execFileSync("bash", …, { timeout: 60_000 })`. It was made async later for a different reason, the
blocked event loop, and kept the same timeout.

**The comments that said the timeout was a bound:**

- `tools/fleet/collect.ts:694-697` (`8f7de0fc`): *"the child below already has its own 60-second
  timeout … This is the backstop behind that timeout rather than a second copy of it."* It was written
  in the same commit whose message had just shown that this 60-second timeout does not end a child.
- `tools/overseer/work-probe.ts:45-46` (`7166b92d`): *"Long enough that a swapping box still answers,
  short enough that a tick does not wedge."* And at `:78-79`: *"up to the 10-second timeout on a box
  that is swapping"*.
- `tools/fleet/health.ts:587-589` (`8215d60f`): *"Covers: binary missing (ENOENT), non-zero exit, and
  the 5s timeout"*.
- `tools/fleet/drain.ts:33-35` and `:96-104`: one send is *"~60 seconds of worst case"* and the pass is
  *"roughly 5 + 60 = 65 seconds"*. It is right about the event loop (`:36`, *"A `Promise.race` cannot
  bound it"*), and wrong about the send it multiplies.

## Why nothing went red

- **The obvious check shares the assumption.** A test that the call comes back with an error after
  the timeout, using `sleep` or a healthy `tmux` as the child, is the third row above: it returns at
  1002 ms with `ETIMEDOUT` and passes. It assumes, as the code does, that the child dies when it is
  told to. The children that are easy to write all do. The two that do not, one that ignores SIGTERM
  and one stuck in uninterruptible I/O, are exactly the box this tool exists to watch.
- **The tests model a timeout as an error value that arrives on time.** `tests/fleet-steer.test.ts:751`
  builds `Object.assign(new Error("spawnSync tmux ETIMEDOUT"), { code: "ETIMEDOUT" })` and hands it
  over instantly. That is the timeout exactly as the comments imagine it. Before this plan, nothing in
  the fleet suite ran a real child past one of these timeouts (checked by grepping `tests/` for a TERM
  trap, for `ETIMEDOUT` and for `sleep`). The first test that does is
  `tests/fleet-child.test.ts:167`, from Stage 1. The only other file with a SIGTERM-ignoring child is
  `tests/run-codex.test.ts`, and it tests the wrapper that already knew.
- **The message names the deadline, not the clock**, which is 260906e's point again. The one site
  written to quote the clock cannot reach that branch. `work-probe.ts:86-87` would say *"killed by
  SIGTERM after N ms (timeout is 10000 ms)"*, but on a timeout `spawnSync` sets `error` as well as
  `signal`. Measured: `{"errorCode":"ETIMEDOUT","signal":"SIGTERM","status":null}`. Line 85 checks
  `error` first, so a timed-out `ps` is reported as *"ps could not be run: spawnSync ps ETIMEDOUT"*.
  That is inferred from reading the code plus that measurement; I did not drive `probeProcessTable`
  itself into a timeout.
- **The knowledge existed and did not travel.** Each earlier sighting was written up at the site that
  hit it: a header in `scripts/`, a commit message, and a caveat in `scripts/worktree-freshen.ts:67-69`.
  None of them was stated at the level of the class. `7166b92d` and `77d01268` wrote new timed
  synchronous calls after `e8f00815`, and `77d01268` came after `8f7de0fc` as well.
- **What did work was a cross-family reviewer and a measurement.** The plan's first draft said
  `execFileSync` *"returns at the deadline and leaves orphans accumulating"*. GPT Sol said otherwise,
  and twenty seconds of `sleep` settled it.

## Other members of the class, which this plan does not fix

The plan converts `panes()`, `generationNow()`, the pane pass, `readExecutions` and the per-minute
health read. **Every one of these stays synchronous and unbounded:**

**On the dashboard server (`tools/fleet/server.ts`), in a request handler:**

| Site | Call | Blocks |
|---|---|---|
| `tools/fleet/steer.ts:581-582` `realIo().run`, plus `capturePane` | tmux `list-panes`, `send-keys`, `pgrep`, 10 s each, up to six per send | every send: the steer route (`server.ts:817`) and action delivery (`routes-actions.ts:152`), via `send-coordinator.ts:352`. The sync `capturePane` stays for exactly this caller. |
| `tools/fleet/routes-actions.ts:1274`, `:1279` `listProcesses` | two `ps`, 10 s each | the box-wide kill actions, which scan twice (`:2362`, `:2400`) |
| `tools/fleet/routes-rename.ts:102`, `:107` | tmux `list-sessions`, `rename-session`, 10 s each | the rename route (`server.ts:863`) |
| `tools/fleet/routes-new.ts:741` → `health.ts:584` `run()` | the six cheap health commands, 5 s each | new-session creation. The plan records this one and leaves it. |

**On the dashboard server, in a loop rather than a request (the same thread, so the same block):**

| Site | Call | Blocks |
|---|---|---|
| `tools/fleet/drain.ts`, via `drainSharedQueues` (`server.ts:521`) | `sendMessage`, as above | every refresh turn with messages queued. `MAX_SENDS_PER_PASS` and `DRAIN_BUDGET_MS` are checked *between* sends, so the header's "about 65 seconds" is really *five seconds plus one unbounded send*. |
| `tools/fleet/readiness-wiring.ts:81` `liveSessionNames` | tmux `list-sessions`, 3 s | the readiness timer, every 120 s (`server.ts:676-678`) |
| `tools/fleet/readiness-git.ts:108` `git()`, `:278` | `spawnSync git` (`merge-base`, `rev-list`, …), 5 s each | the same timer. These headers (`readiness-wiring.ts:15-17`, `readiness-git.ts:9-14`) moved git off the request path *because* it can block, and put it on a timer that runs on the same thread. |

**On other long-running processes**, where it blocks that process's own loop rather than the page (the
middle tier in CLAUDE.md's three standards):

- The Overseer daemon: `tools/overseer/daemon.ts:549` calls `probeProcessTable` every tick, and
  `tools/overseer/usage.ts:1342` runs `claude auth status` with a 20 s timeout in the daemon's usage
  pass (`scripts/overseer.ts:106-123`).
- `tools/overseer/attention-probe.ts:39`, `:89`: tmux, 10 s. It is reached through `attention-cli.ts`,
  which `scripts/overseer.ts:37` imports. I did not verify whether the daemon runs it or only the CLI
  does.
- `scripts/readiness-loop.ts:229` `runCommand`: a periodic runner that blocks only itself.

**CLI only**, which blocks a terminal rather than a server and so is less urgent:
`scripts/gjd-remote.ts:5265` (`ssh`, caller-chosen timeout), `scripts/worktree-check.ts:890` (`ss`,
10 s), `scripts/worktree-freshen.ts:81` (`git fetch`, 120 s; its comment knows half of this),
`scripts/overseer-launch-mode-specimen.ts:98`, `:116`, `:138`, and `scripts/fleet-collect-bench.ts`,
which is the instrument and uses the blocking call on purpose. The many other synchronous calls in
`scripts/` pass no `timeout` at all. They claim no bound, so they are not members of this class.

## The fix that is right for the long term

**Built in this plan: [`tools/fleet/child.ts`](../../tools/fleet/child.ts)**, whose header states the
contract:

- `runOwned` frees the caller at `timeoutMs + graceMs`, with one shared deadline rather than two
  graces in series. That is the bound, because the caller stops waiting.
- It sends SIGTERM and then SIGKILL to a process group it proved at spawn. The pgrp and the start time
  are read from `/proc/<pid>/stat` immediately after `detached: true`, and the start time is checked
  again before every signal, so a recycled pid is never signalled.
- A child counts as stuck only on `exit`, never on `close`, so a helper holding a pipe does not make a
  dead child look alive.
- A registry refuses a second child for the same key while one is unaccounted for. The refusal ends on
  an observed exit or an identity proof, never on time alone, so one wedged `vmstat` cannot become one
  new `vmstat` per minute.

**What it does not solve.** A child in uninterruptible I/O still cannot be killed, not even by SIGKILL.
The owner stops *waiting* for it and refuses to start its sibling, but the process lives until the
kernel lets it go. The registry is also in memory only: a server restart forgets the stuck survivor and
can start a sibling of it (`child.ts` header, "Known limitation"). And it covers only the calls that
are converted. Everything in the tables above is still the old shape.

**What shipped before this was fixed at the instance and should not be taken for the design.** The
120-second race in `8f7de0fc` bounds one caller. The drain's two counters bound how many unbounded
calls one pass makes. The right shape is that **no long-running process calls a synchronous child
API at all**, so every child on the dashboard, and on the daemon, goes through one owner.

## What would have caught it, ranked by ease against value

1. **Assert every bound as elapsed wall-clock time, against a child that refuses the signal.** For
   each probe, substitute `sh -c 'trap "" TERM; sleep 30'` and assert that the caller is back within
   `timeout + grace + slack`, whatever the outcome. `tests/fleet-child.test.ts:167` is the template,
   and it costs one test per seam. Against any of today's `execFileSync` probes it goes red at about
   30 s rather than 1. Aimed at the class: rename every function and the rule still reads the same.
2. **A test that fails if a long-running process can reach a synchronous child API.** Walk the import
   graph from `tools/fleet/server.ts` (and `tools/overseer/daemon.ts`), and fail on any module in it
   that imports `execFileSync`, `spawnSync` or `execSync` from `node:child_process` as a value.
   Exceptions go in an allow-list with a reason each, and the list must only shrink. On day one it
   holds the rows above. `tests/fleet-imports.test.ts` already walks exactly this graph with Babel and
   has a self-check, so most of the work exists. *Proposed, not built.* Put it in the suite rather than
   in Biome (`noRestrictedImports` with an override on `tools/fleet/**`, which is cheaper to write):
   `npm run lint`'s baseline is not clean, so a lint finding here is advice, while a test is a gate
   ([static-analysis.md](../project/static-analysis.md) lists what gates). I did not check whether the
   installed Biome can restrict a single named import.
3. **Make every timeout message quote the measured clock beside the limit**, e.g.
   `after 30012 ms (limit 10000 ms)`. It is 260906e's second countermeasure, still undone, and it turns
   this silent failure into a loud one on its first occurrence. In `work-probe.ts:85-87` the fix is
   one reordering, so that the signal branch is reached. Cheap. It belongs at the sites, not in a doc.
4. **A sentence in the fleet's process-model doc saying that sync child APIs are CLI-only.** On its
   own, rejected. The fact was already written down three times and did not stop `77d01268`. It is
   worth having only as the failure message of item 2.
5. **Move the whole collection into a subprocess.** Rejected, for the reasons in
   [the plan](../plans/260910c-responsive-collection-monitoring-must-keep-answering-while-it-measures.md#the-two-simpler-options-we-are-not-taking):
   it moves the wedge into the child rather than bounding it, and every leaf probe stays unbounded
   inside it.

## The thing I would tell myself

I read `timeout: 10_000` as a sentence about time, and it is a sentence about signals. I wrote the
first draft of this plan around orphans that accumulate. That is the failure mode of a call which
*does* return at its deadline, and I never checked that this one does. The warning was in
`scripts/subagent-cli.ts` four days earlier, in two lines, and I had not read it because it lived in
a file about something else. Twenty seconds with a child that ignores SIGTERM would have told me. Of
any deadline, ask what it does when the other side refuses, and time that case rather than read it.

---

Up: [postmortems.md](../project/postmortems.md)
