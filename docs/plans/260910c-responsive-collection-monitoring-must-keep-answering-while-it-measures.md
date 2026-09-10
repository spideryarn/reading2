# Responsive collection — monitoring must keep answering while it measures

**Status (2026-09-10): finished.** Stages 0–3 are built, independently reviewed by GPT Sol, and
measured; Stage 4, the title cache, was dropped on its measurement by the Overseer's decision. The
acceptance line is met: a 30-second probe now leaves `/api/state` at p95 **7.2 ms** against a
provisional 250 ms target, where it held it for 30 s; and a real production turn holds the request
thread for at most about 40 ms, where it held it for about 1.6 s. Full suite on the merged tree: 986
files passed, and the only two reds are the known environment pair that needs `api-dist/`. Found on
the way and handed to the Overseer rather than fixed: the other unbounded synchronous child calls on
the same thread (postmortem 260910a, queued), and `selfCheck` switched off in production by the move
to systemd (postmortem 260910b, queued as `qi-j4jyf3ab`). Codex (gpt-5.6-sol) implemented every
build stage; each had an independent review.
Dispatched by the Overseer as queue item `qi-n6seyeks`, from
[260908f-overseer-and-fleet-improvement-roadmap.md](260908f-overseer-and-fleet-improvement-roadmap.md)
§ "Stage: Responsive collection". That stage's six checkboxes and its acceptance paragraph are the
spec; this doc is how they get built and what got measured.

## What is wrong, stated as a mechanism

The fleet dashboard is one Node process. It serves `/api/state` from module-level variables —
`snapshot`, `health`, `lastError`, `attemptedAt` — so the answer is a composition over data that has
already been collected. That is not what makes the page slow. What makes it slow is that the same
process, on the same thread, runs the collection with **synchronous child processes**, and a
synchronous child process stops the event loop for its whole duration. While `execFileSync` is
waiting, the HTTP server accepts nothing, parses nothing and writes nothing. Cached data behind a
blocked loop is not a cached answer.

### And the timeouts on those calls do not bound anything

This is the finding the plan was rewritten around, and it inverts what the first draft claimed.

> `timeout was 1000 ms; execFileSync came back after 20019 ms — threw: spawnSync sh ETIMEDOUT`
>
> — `execFileSync("sh", ["-c", 'trap "" TERM; sleep 20'], { timeout: 1_000 })`, measured on this
> box, 2026-09-10

`execFileSync`'s `timeout` sends `SIGTERM` at the deadline **and then goes on waiting for the child
to exit**. A child that ignores `SIGTERM` — or is in uninterruptible I/O on a swapping box, which is
the box this tool exists for — blocks the event loop for as long as it likes, and the error the
caller finally gets says `ETIMEDOUT`, naming a deadline that was not enforced. So:

- `capturePane`'s 10-second timeout, `panes()`'s 10 seconds, `generationNow()`'s 5, and each of
  `collectHealth`'s seven commands at 5 — **none of these is a bound.** They are a signal, and then
  an unbounded wait.
- The first draft of this plan said the opposite: that `execFileSync` returns at the deadline and
  leaves orphans accumulating. GPT Sol contradicted it and the measurement above settles it. The
  ownership work in Stage 1 is still needed, but for a different reason: today's failure mode is
  **indefinite event-loop blockage**, not accumulated orphans.

### The blocking calls, in the order one turn of `refreshOnce` makes them

| Where | Call | Nominal timeout | Measured | Blocks the loop |
|---|---|---|---|---|
| `collect.ts` `generationNow()` | `tmux display-message -p '#{pid}'` | 5 s | 12–21 ms | yes |
| `collect.ts` (the inventory) | `bash -c sessionScript()` | 60 s | **4.9–5.1 s** | **no** — already `promisify(execFile)` |
| `collect.ts` `panes()` | `tmux list-panes -a` | 10 s | 11–19 ms | yes |
| `collect.ts` `readPanes()` | `tmux capture-pane` × one per eligible row | 10 s each | **299–344 ms** for 24–25 | yes |
| `collect.ts` `readExecutions()` | `ps` × 2 (`tools/overseer/work-probe.ts`) + one `/proc/<pid>/stat` per harness | 10 s | **186–199 ms** | yes |
| `health.ts` `collectHealth()` | `uptime`, `nproc`, `free -b`, `swapon`, `df -k /`, **`vmstat 1 2`**, `ps -eo rss,args` | 5 s each | **1162–1184 ms** | yes |

None of those nominal timeouts is enforceable, per the measurement above.

## What this stage does and does not claim

**It claims: the collection and the health reading stop holding the request thread.** It does not
claim "the dashboard is responsive", because `drain.ts` holds the same server in synchronous
`execFileSync` tmux calls on any turn with messages queued. Its header puts the worst case at "about
65 seconds"; **after this plan's finding that is wrong too — it is five seconds plus one *unbounded*
send**, because each of those ten-second timeouts is a signal and not a bound, and the pass's two
counters are checked only *between* sends. That is delivery, not measuring, and it is somebody
else's stage. GPT Sol's finding, corrected by the postmortem below.

### Found on the way, and not fixed here

- **The class has a postmortem:**
  [260910a — a timeout that signals and then waits is not a bound](../postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md).
  It had been met twice before and fixed only where it hit (`e8f00815` in `scripts/subagent-cli.ts`,
  `8f7de0fc` on the async inventory call). It lists every other member on the dashboard's request
  path and loop — `steer.ts`'s send, `routes-actions.ts`, `routes-rename.ts`, `routes-new.ts`,
  `drain.ts`, `readiness-wiring.ts` and `readiness-git.ts` — and on the Overseer daemon, none of which
  this plan converts, and ranks three countermeasures, the strongest a test that walks the import
  graph from `server.ts` and `daemon.ts` and fails on any value import of a synchronous child API.
- **The one message written to quote a timeout's clock can never be printed.** On a timeout
  `spawnSync` sets `error` and `signal` together, and `probeProcessTable` checks `error` first, so
  its *"killed by SIGTERM after N ms"* branch is unreachable and a timed-out `ps` reads *"could not be
  run"*. Stage 3b's extraction in that file is authorised on a no-behaviour-change condition, so it
  leaves this alone; the async path reports the clock correctly anyway.
- **A third environment red in any fresh worktree.** `tests/fleet-decisions-route.test.ts` imports
  `server.ts`, which exits at load (`process.exit(2)`, line 113) when the fleet web client has not
  been built — and `npm run build:fleet` is not part of `npm run build`, so no worktree has it. It
  joins the two bundle tests (`cold-start-lazy-imports`, `pdf-bundle-trace`) that a worktree without
  `api-dist/` always reds. After `npm run build:fleet` it is 15/15.

**No speed improvement is claimed without before/after output** from `scripts/fleet-collect-bench.ts`
pasted into the Measurements section. The roadmap's "12-second grepping" is context from a source
comment, not a benchmark, and the "236 ms over 26 sessions" for `readExecutions` was another
session's figure on another day — both were re-measured before anything moved.

## The two simpler options we are not taking

**A collector subprocess.** The first draft rejected this on the grounds that collection reaches
module state, the routes, the drain and the health-history writer's single-writer lock. **That
reason was wrong and GPT Sol showed why:** `collect()` returns a `FleetSnapshot`, `collectHealth()`
returns a `HealthReport`, and `refreshOnce` in the parent already owns every mutation, publication,
retention and drain. A child that printed a `FleetSnapshot` as JSON would need no writer or route to
move — and the snapshot is already `JSON.stringify`'d for the wire, so the serialisation boundary
exists.

It is still not what we are doing, for three reasons stated honestly rather than the wrong one:

1. **The roadmap asks for the conversion by name** — "convert remaining synchronous collection/health
   subprocesses on the fleet request process to asynchronous bounded probes" — and a subprocess
   discharges the symptom while leaving every leaf probe unbounded inside the child, where the same
   wedge now blocks a whole collection instead of a whole server.
2. **Health must be readable when the collection fails.** `refreshOnce` takes the vitals whatever the
   collection did, because a collection fails exactly when the box is in trouble (GPT Astra's A17).
   One collector child carrying both re-couples them; two children is two boot costs.
3. **The boot cost is not small.** A `tsx` child that imports this module graph costs on the order of
   a second before it does any work, against a collection that is already 5–6 s. A long-lived child
   with a request/response protocol avoids that and is materially more machinery than four
   mechanical conversions.

If the residual blocking after this stage is still material, this is the next thing to weigh — and
it will be weighed against Stage 0's numbers rather than a guess.

**A shorter `execFileSync` timeout.** Now provably useless: the measurement above shows the timeout
is not enforced at all.

---

## Stage 0 — Measure, before anything moves ✅

- [x] **The instrument**, `scripts/fleet-collect-bench.ts`, in three modes: `--mode=real` against
      this box, `--mode=slow-probe` for a single probe of a chosen length, and `--mode=fixture` for
      the controlled N-session case the 250 ms p95 is quoted against.
- [x] **The latency measurement is a real HTTP request from another process.** An in-process client
      cannot measure a blocked event loop, because it is blocked too.
- [x] **And event-loop lag beside it**, from a 5 ms interval measuring its own drift — the same fact
      seen from inside, sharing no machinery with the HTTP measurement.
- [x] **Record date, load average, session count, fixture size and the exact command.**
- [x] **P1 from GPT Sol: the sampler censored its own slowest requests.** It issued a request every
      25 ms, waited 300 ms after the phase and then `SIGKILL`ed the child without waiting for what
      was in flight — so the first 30-second run recorded 641 completions out of roughly 1,200
      issued. The *baseline* conclusion survived it (the dropped requests were issued during the
      block and would have been at least as slow), but **a future p95 could have passed by omitting
      exactly the requests that would have failed it**. Now: the child reports its own `seq` as
      `issued`, the parent stops it issuing, drains what is in flight, gives anything still
      outstanding a lower-bound latency, and `report` **refuses to be evidence and exits 3** if the
      parts do not add up. *Mutation-verified*: with `issued` deliberately inflated by five, the run
      printed "THIS RUN IS NOT EVIDENCE — 5 of the 103 requests it issued are unaccounted for" and
      exited 3.
- [x] **P1: the bench exercises the real composition path**, not a fixed cached string — its
      `/api/state` calls the real `statePayload()` with the real checkpoint read, per request, so a
      day when the composition starts doing real work cannot pass unnoticed.
- [x] **P1: the fixture asserts what it exercised** — it counts probes and throws unless exactly N
      cheap captures and exactly one slow one ran.
- [x] **And a hole neither of us had named: the poller was unbounded.** Fixing the accounting made
      the fixture run hang for ten minutes, because at 40/s against a server blocked for thirty
      seconds ~1,200 sockets pile up, well past the listen backlog — and beyond it Linux silently
      drops the client's ACK and leaves the socket retransmitting for minutes. That measures the
      kernel's accept queue, not the server. In flight is now capped at 64, every request carries a
      client-side timeout that reports a lower bound rather than being lost, exactly one line is
      emitted per request, and `stop()` is itself bounded so a poller that will not drain becomes a
      loud accounting failure instead of a hung bench.
- [x] Once Stage 1 exists, drive the real `runOwned` path in the fixture rather than an injected
      `execFileSync("sleep")`.

## Stage 1 — Owned children: a probe you can stop waiting for and still be responsible for

**Status (2026-09-10): built and reviewed; Codex implemented both rounds.** The implementation run
(GPT Sol, workspace-write) hit its 45-minute wall before writing a report but had finished the code,
and handled the hardest part better than the brief asked: when neither `exit` nor `close` has
arrived, it samples the kernel and counts only `Z`/`X` or `ENOENT` as evidence of death. The review
round fixed two P1s — both about signalling the wrong thing: **pid reuse** (a recycled pid leading
its own group would have had `SIGKILL` sent to a stranger's whole group; start time is now captured
at spawn and a mismatch sends nothing) and **the group proof taken at kill time** (a vanished leader
left its descendants unreachable; the proof is now captured at spawn). 13 tests → 28, each red
first. **Mutation-verified afterwards, by me rather than the reviewer:** disabling the start-time
comparison in `checkIdentity` turned exactly the two pid-reuse tests red — 2 of 28, nothing else —
and restoring it returned 28/28. The guard is real, and the tests aim at it and at nothing nearby.

*Accepted after checking:* the review added parent `SIGINT`/`SIGTERM` forwarding — process-global
listeners that signal owned children and then re-raise. `git grep` at `HEAD` found no signal handler
anywhere in `tools/fleet`, `tools/overseer` or `tmux-job.ts`, so forward-then-re-raise reproduces
Node's default death plus child cleanup. **Whoever adds the first shutdown handler to `server.ts`
must reckon with it**: a handler that does not exit would see the re-raise and run twice.

*Residual, recorded rather than fixed:* the post-exit descendant sweep signals the group on the
spawn-time proof a grace after the leader is reaped. If every member of that group died and the
group id was recycled into a new group leader inside that one second, the sweep would reach it. With
`pid_max` in the millions and a one-second window this is not worth more machinery; it is written
here so the next person to widen the window knows.

New module `tools/fleet/child.ts`, importing nothing but node builtins.

- [x] **`runOwned(spec)`** — `spawn`, stdout under a byte cap, and a lifecycle whose arms are
      distinguishable: `ok` / `failed` / `timed-out` / `refused` / `overflowed`. The caller is freed
      at `timeoutMs + graceMs` and not a millisecond later: SIGTERM at the deadline, SIGKILL a grace
      later, settle on `setImmediate` after it so an `exit` in the same tick still counts. **Not two
      graces in series** — `scripts/subagent-cli.ts`'s GPT Sol F11 is exactly that mistake.
- [x] **`stuck` is decided on `exit`, NEVER on `close`** — GPT Sol's P1, and the plan had it wrong.
      `exit` says the process is gone; `close` also waits for everything holding its stdout and
      stderr pipes, so a helper that escaped into another group keeps `close` pending after the child
      is dead. Defining `stuck` by `close` would report a dead child as stuck and **refuse that probe
      for ever**. So: listen to both, start a bounded pipe-flush grace from `exit`, destroy the read
      streams when it expires, and let `exit` alone decide whether the process is still with us.
- [x] **The group proof is captured at spawn, not at the kill.** GPT Sol's second P1 here: by the
      time we want to signal, `/proc/<leader>/stat` may be gone while its descendants are alive, and
      a proof that cannot be re-taken is a fallback to signalling a dead pid and leaking the rest. So
      immediately after `spawn` (`detached: true`, which makes the child its own group leader) read
      `/proc/<pid>/stat` once and keep **both** the process-group id and the **start time** — start
      time because a pid consulted later may name a stranger (`tools/overseer/work.ts` says so
      already). Signal the group only when the recorded pgrp equals the pid *and* the live start time
      still matches; otherwise signal the pid alone and say which in the `why`.
      `/proc/<pid>/stat`'s `comm` field is parenthesised and may contain spaces and parentheses, so
      parse the fields after the **last** `)`.
- [x] **`refused` is how "repeated timeouts do not multiply live owned children" is enforced**, and
      **it does not expire on time alone.** A time-based expiry turns one D-state child into one new
      child per period, which is the multiplication the roadmap forbids. It ends when the child's
      exit is observed (including late, after `stuck` was reported), or when an identity check proves
      that exact process is gone. Different keys are independent: a stuck `vmstat` must not stop
      `free` being read.
- [ ] **One owner, at module scope.** An owner built inside `collect()` or `collectHealthAsync()`
      forgets every stuck child on the next turn, which is the same bug `singleFlightCollect` is
      module-scoped to avoid (`server.ts`). **Known limitation, recorded rather than solved:** a
      server restart loses the registry and can start a sibling of a genuinely stuck survivor. Adopting
      survivors across a restart is a bigger piece of work than this stage; it is written into the
      module header so nobody has to rediscover it.
- [x] **Everything `subagent-cli.ts` paid for, restated here so it is not paid twice:** fd 0 never
      inherited (`"ignore"`); the child's `error` event handled, so a spawn failure is a `failed`
      value and never a throw; pipes drained or destroyed after overflow and after exit; UTF-8
      decoded through `StringDecoder`; the parent's own `SIGTERM`/`SIGINT` forwarded to detached
      children, or a dashboard restart orphans them; and descendants swept even when the leader
      exits cleanly.
- [x] **`limit(n)`**, a small concurrency limiter, so cheap independent probes run a few at a time
      rather than one child per session at once.
- [x] **Tests, red first**, driven by a fake spawn where a real process cannot make the case: a clean
      exit; a non-zero exit; `ENOENT`; a child that ignores SIGTERM and dies on SIGKILL (real:
      `sh -c 'trap "" TERM; sleep 30'`) settling at about `timeout + grace`; a child that never exits
      (fake — SIGKILL is uncatchable, so an unkillable child cannot be manufactured, and the comment
      must say so) staying in `live()` and refusing the next call for its key while spawning nothing;
      **a child whose `exit` fired but whose `close` has not, which must NOT be stuck**; a different
      key running while the first is refused; a late exit clearing the refusal; the group proof in
      its three outcomes; `/proc` parsing with a `comm` containing a space and a `)`; overflow
      settling; and `limit(2)` never exceeding two.

## Stage 2 — Health off the request thread

**Status (2026-09-10): built by Codex, independently reviewed by GPT Sol, measured.** Codex
implemented both the build and the review round.

**Measured — Stage 2's before and after in one run** (`npx tsx scripts/fleet-collect-bench.ts
--mode=real --runs=2`, load ~9, 24 sessions; request accounting 1055 issued = 1055 completed):

| phase | wall | loop lag p95 | loop lag max |
|---|---|---|---|
| `collectHealth`, synchronous — before | 1160 / 1161 ms | 1159 / 1161 ms | **1159 / 1161 ms** |
| `collectHealthAsync`, owned — after | 1021 / 1021 ms | 2.1 / 2.4 ms | **30 / 44 ms** |

Wall time barely moves — `vmstat` still waits out its sampling interval — and that was never the
claim. **The thread that answers `/api/state` is free while it happens**, and no child was left
alive afterwards. (The run's overall HTTP p95 still includes the bench's synchronous *before*
phases, so it is not a Stage 2 number; the whole-collection after comes with Stage 3.)

**The independent review found a P1 the implementing run's review had not: the limiter bounded
pending *calls*, not surviving *children*.** `limit(3)` frees a slot when a call settles, and a
timed-out call settles at `timeoutMs + graceMs` while its child can live on — so across turns, seven
children could accumulate, one per key. A health-wide cap of four now refuses locally, naming every
live child's pid and age. A call whose own key already has a live child is still passed to the
owner, which re-checks that child's kernel identity — so one missed exit event cannot pin the cap
for ever. *Recorded, not a hole:* the cap is checked when a call starts, so one turn's concurrent
starts can overshoot four; they can never exceed seven, because the owner's one-child-per-key rule
is the hard bound. It also restored the measured duration to `failed` and `overflowed` reasons.

**Decided, no change: `publish` waits on the health turn.** A `vmstat` that wedges delays that turn's
publish by its 10-second deadline plus the 1-second grace, and is `refused` instantly on every later
turn. It holds the *loop*, never the event loop — `/api/state` keeps answering from the previous
state throughout, and a test now pins that — and publishing before health would reorder a turn
`refresh.ts` deliberately preserves. The reviewer recommended no change; so do I.

**How it got here.** The implementing run's own review was not independent — its nested reviewer
failed to start and it dispatched a same-model subagent instead
([260910c-stage2-code-review-sol.md](260910c-stage2-code-review-sol.md) is that record and says so).
It fixed four real things, which the independent review then re-checked as unreviewed code. **No
step of `refreshOnce` moved**: the only code change in `refresh.ts` is `await` on `refreshHealth`;
its header's steps 3 and 4 were reworded to *publish, then retain*, which is what the code has done
since GPT Sol's finding 11 while the header still said the opposite.

- [x] **Split the assembly from the gathering.** `assembleHealth(reads)` takes the seven command
      outcomes and returns the `HealthReport`. One place decides what a reading means.
- [x] **`collectHealthAsync(owner, options)`** gathers through `runOwned` under `limit(3)`, with
      `vmstat 1 2` on its own longer bound. **The synchronous `collectHealth` stays, over the same
      `assembleHealth`** — `routes-new.ts` and `scripts/readiness-loop.ts` are other people's files
      and keep working untouched. A test asserts the two gatherers produce an **identical report**
      from identical command output, so they cannot drift.
- [x] **Health failure stays separate from fleet failure** (`refreshOnce` already does this), a
      `refused` or `timed-out` probe becomes that field's `unknown` **with the pid and the duration
      in the `why`**, and **swap's since-boot first sample stays excluded** — a test pins that.
- [x] `RefreshDeps.refreshHealth` becomes `() => Promise<HealthTurn>`; `server.ts` awaits it.
- [x] **Recorded, not fixed:** `routes-new.ts:741` still calls the synchronous quick health
      (~135 ms measured) on the request process when a new session is created. It is a route file and
      not ours; it is a rare, deliberate, user-initiated request rather than a per-minute poll; and
      the async collector is now there for its owner to adopt.

## Stage 3 — The tmux probes, the pane pass, and the process table

**Built in two halves, one after the other**, because Stage 1's implementation alone hit a 45-minute
Codex wall and this stage touches four files plus `tools/overseer/`. **3a** is the tmux probes and
the pane pass, and moves the bench's fixture onto the real owned path; **3b** is `readExecutions` and
the `work-probe.ts` extraction. Both edit `collect.ts`, so they cannot run concurrently — two
processes writing one file is a merge conflict nobody asked for.

**Status — 3a (2026-09-10): built by Codex, independently reviewed by GPT Sol, acceptance measured.**
`generationNow()`, `panes()` and every pane capture now go through the one module-scope owner
(renamed `fleetProbeOwner`, since it now owns health and tmux probes both).

**The acceptance line, measured** — same instrument, same 25-session fixture, one pane's capture
taking 30 s, runs minutes apart at load 10–14:

| `/api/state` while one capture takes 30 s | median | **p95** | max | answered in those 30 s |
|---|---|---|---|---|
| synchronous — before (`--variant=sync`) | 29222 ms | **30018 ms** | 30096 ms | 85 (85 = 85) |
| owned, async — after (`--variant=owned`) | 4.2 ms | **7.2 ms** | 57.8 ms | 1209 (1209 = 1209) |

The target was a provisional 250 ms p95. The 30-second child lived its full 30,013 ms and ended
`ok`; no child was left alive. **This is the pane pass in isolation**: `readExecutions`' two
synchronous `ps` calls are still on the real collection path until 3b, so the whole-collection
after on the real box comes then.

**What the review changed.** (1) *The calls-versus-children gap again*, which the Stage 2 review
found in health: `limit(4)` bounds pending captures, not surviving children, so captures could
accumulate as pane ids change. A four-child capture cap now matches health's; health children are
not counted, and a same-key call still reaches the owner's re-check. (2) *The capture deadline is
2 s, not 10*: a healthy capture measures 12–14 ms here (over 140× headroom), and the worst wedged
turn — about 98 s all told — now fits inside the 120 s collection deadline, where 10 s captures
could not. (3) *The bench refuses more flattering evidence*: a run with no requests, or with
failed ones, balances perfectly and is still not evidence, so both now exit 3.

**What I fixed myself before the review**: the rename broke a Stage 2 source guard that named the
owner, which 3a's scoped gate list could not see and the every-fleet-file sweep did; and the bench
could not isolate the owned pass or let its slow child live the full 30 s, so it could not have
proved the acceptance sentence at all (`--variant`, and the slow child's default deadline).

**A correction, and a finding that predates this plan.** This plan's 3a brief said an unreadable
pane listing "is an empty map, and the snapshot still arrives". **The second half is false whenever
the collector runs inside a tmux pane** — a tmux-job dashboard, or this plan's bench run from a
pane: `selfCheck` looks for its own pane in that empty map, returns `absent`, and `collect()` throws
*"this is not a listing of this box"* — naming the wrong cause for a slow or failed `list-panes`,
and contradicting `panes()`'s own comment that the row is still worth showing. It predates
`b2029e4d`; 3a makes it more reachable, since an owned timeout now produces that map too. **Stage 3b
fixes the sentence**: the listing is a union of *read* and *unread*, and an unread one fails the
collection truthfully, still without publishing a listing nobody could verify.

**And the premise the reviewer and I both held was itself wrong.** The review said this fires "under
production's tmux environment", and I copied that into this plan and 3b's brief before checking it.
**Production has not run under tmux since 2026-09-08**: the dashboard is `fleet-dashboard.service`
under systemd, and the process that runs `collect()` has no `TMUX` and no `TMUX_PANE` (verified
read-only on the live process). So in production `selfCheck` returns `cannot-check` on every
collection: this bug is masked there — **and so is the wrong-box protection**, which has been off
in production since the move, about 13 hours after it landed. Postmortem:
[260910b — a later check reads an earlier fallback as evidence](../postmortems/260910b-a-later-check-reads-an-earlier-fallback-as-evidence.md).
The Overseer queued a `selfCheck` that works under systemd, with its verdict reported on
`/api/state`, as its own stage (`qi-j4jyf3ab`), and withdrew the "publish the rows unverified?"
question as moot.

**Status — 3b (2026-09-10): built by Codex, independently reviewed by GPT Sol, measured.** `readExecutions`' two `ps`
calls now run through the owner, one after the other under one shared key, with every `/proc` read
between them — **the order is the pid-reuse defence and it is unchanged**; a stuck first `ps` refuses
the second and the refusal carries its pid, an honest half-bracket rather than a false whole one.
`atMs` is stamped after the child returns. The `/proc` reads stay synchronous on purpose:
microseconds, not subprocesses, and their position between the two tables is the defence.
**`tools/overseer/work-probe.ts`**, under the Overseer's three conditions: the checks moved verbatim
into a pure `readingFromPs`; `probeProcessTable` calls it, so there is one copy; its spawn-shaped
checks — including the known unreachable "killed by SIGTERM" message — are untouched; and a test
drives `readingFromPs` alone with a foreign process table and watches it refuse. The pane listing is
a union of `read` and `unread`, `snapshotFrom` accepts only a read one, and an unread one fails the
collection with *"could not read this box's tmux pane listing: …"*.

**The whole collection on the real box, before and after, in one run** (`npx tsx
scripts/fleet-collect-bench.ts --mode=real --runs=2`, load ~9–10, 23–24 sessions; request
accounting 1084 issued = 1084 completed):

| phase | loop lag max |
|---|---|
| *before, same run:* `tmux capture-pane` × 24, synchronous | 297 / 293 ms |
| *before:* `ps` × 2, synchronous | 190 / 167 ms |
| *before:* `collectHealth`, synchronous | 1161 / 1185 ms |
| **after: `collect()` end to end, every probe owned** | **31.6 / 28.1 ms** (p95 2.3 / 2.5 ms) |
| **after: `collectHealthAsync`, owned** | **34.6 / 36.9 ms** (0 children live after) |

Every earlier run of this bench had `collect()` holding the thread for up to **409–478 ms**; it is
now under 32 ms, roughly 15× lower, while its wall time is unchanged at ~5.3 s because the async
inventory script still dominates it. **So a production turn — collection plus health — never holds
the request thread for more than about 40 ms.** What remains on the thread is `statePayload()` at
~2.5 ms per request, and `drain.ts`, which is out of this plan's scope and now queued. (The run's
overall HTTP p95 still includes the bench's synchronous *before* phases, so it is not an *after*
number; the HTTP acceptance is 3a's fixture above.)

**The independent review found no behavioural defect**, and every guard this stage rests on has now
been seen to fail: disabling `readingFromPs`'s positive control reds the foreign-table test; running
the two `ps` calls concurrently reds the ordering test; stamping `atMs` before the await reds the
timestamp test; skipping `selfCheck` reds the read-but-missing-pane test; publishing an unread
listing reds the listing test. It corrected both source comments that carried the false "production
runs under tmux" premise — `panes()`'s new one, and the older one near `collect.ts:616` — with a
source guard that fails on either coming back, and widened the probe-failure coverage to both `ps`
calls and both refused and timed-out outcomes (a mutation that drops the owner's `why` reds all four).
`selfCheck`'s behaviour is unchanged.

- [x] `capturePaneAsync` beside `capturePane` in `pane.ts` (the sync one stays — `steer.ts` uses it),
      and `readPanes` becomes async over `limit(4)`. `tests/fleet-launch-mode.test.ts` drives
      `readPanes` at four call sites and must be updated with it.
- [x] `panes()` and `generationNow()` go through the owner. Their bargains are unchanged: an
      unreadable listing is now an `unread` arm (3b; it was an empty map), an unreadable generation is `null` meaning *unverifiable*,
      and only two numbers that disagree are drift.
- [x] **`readExecutions`' two `ps` calls, which are no longer optional.** GPT Sol's P1: at 186–199 ms
      measured, against a 470 ms synchronous tail and a 250 ms target, they are responsiveness work.
      It needs the "is this a reading of THIS machine" positive control inside `probeProcessTable`
      reachable from an already-fetched stdout — **a pure extraction in
      `tools/overseer/work-probe.ts`, authorised by the Overseer on 2026-09-10** on these conditions:
      no behaviour change, `probeProcessTable` calls the extracted function so the checks stay in one
      copy, and **a test that drives the extracted function alone with a foreign process table and
      watches it refuse** — the positive control has to be shown firing from the new entry point, not
      only from the old one.
- [x] **Per-field unknowns are preserved**, and each now says which kind of not-looking it was: a
      pane not reached because its probe was refused behind a stuck child reads differently from a
      pane whose capture failed.
- [x] Re-run the bench with the fixed accounting. Before/after in this file, or no claim.

## Stage 4 — The title lookup

**Status (2026-09-10): dropped, on the Overseer's decision, with the measurement as the reason.**
The boxes below are left unticked on purpose: they describe a design that was worked out and then
not built.

**Measured**: the title grep inside `buildSessionScript` costs **236–251 ms per collection** — 25
most recently written transcripts, 85 MB, a warm page cache, which is the realistic case for a
once-a-minute job — inside an inventory that takes **4.4–5.1 s** and already runs in an awaited
async child. So it costs about 5% of the inventory's freshness and **nothing** of the server's
responsiveness. The "10–12 s, the dominant cost of a whole collection" in `gjd-remote-tmux.ts`'s
comment was `gjd-remote ls` measured through `ssh`, not the dashboard; that comment is corrected in
the same commit as this paragraph, because it is what would send the next reader down this path.

**Against it:** the correct design is the inode-keyed incremental cache below — a day of careful work
with several ways to show a title wrongly or stale, a bug nobody would notice — for about a quarter of
a second of freshness a minute. A cheap version does not exist: a bounded tail is provably wrong,
because Claude titles a conversation early.

**Revisit when**, in the Overseer's words as a number: the title grep across live transcripts
**exceeds about two seconds per pass** (roughly eight times today's 85 MB), **or it ever moves onto
the request thread**. Then build the cache as specified below. The Overseer logged this as its own
engineering call — no user-visible change, measured rather than guessed — so it is not a question for
Greg.

Demoted from "the dominant cost" by Stage 0: the inventory takes **5.0 s and is already async**, so
the title grep costs *freshness* and no responsiveness at all. The 10–12 s in the source comment was
`gjd-remote ls` measured through `ssh`; this is the same script run locally by `bash`.

- [ ] **A fleet-only option, leaving `gjd-remote`'s output alone.** `parseSessionLine` requires
      exactly fourteen fields and `gjd-remote`'s `ls`, `new`, `resume` and provisional-name adoption
      all consume them, so `buildSessionScript()`'s default behaviour does not change. Add an option
      that skips the title grep, used only by the fleet collector, and resolve titles in TypeScript
      afterwards — reusing `findTranscript()`'s relocation and duplicate-copy policy rather than
      writing a second one. A bash-side cache would need durable files, locking and invalidation
      because each bash process dies after one collection; that is substantially worse.
- [ ] **The cache's invalidation rules, which GPT Sol supplied and the first draft lacked.** Key on
      filesystem identity **`dev:ino`**, with the path as a *locator* and not the identity — that way
      a genuine move (which `EnterWorktree` does to transcript files, `tools/fleet/transcript.ts`)
      keeps its cache, and a relocation that copied rather than moved changes the inode and correctly
      forces a full re-read. Keep previous **size and mtime**, and re-read in full on a shrink, an
      identity change, a chosen-copy change, or an mtime change without ordinary growth — because a
      same-size in-place rewrite and a truncate-and-regrow are both invisible to size alone. **Retain
      an incomplete trailing line** and join it to the next appended bytes; half-written final JSONL
      records are expected here (`transcript.ts`). Bound the cache by count with an LRU, or a server
      running for weeks accumulates an entry per dead session.
- [ ] **A title absent from the appended bytes is previous-known, never a removal**, which is also
      why a plain `tail -c` is wrong: Claude titles a conversation early, so a tail would
      systematically report every long session as untitled. Pinned manual names, provisional-name
      semantics and re-titling each keep working, each with a test.

---

## Decisions taken, so they are not re-litigated

- **The per-probe attempted/failed/last-good payload is dropped, and the roadmap's checkbox is
  discharged by what is already there.** The roadmap asks that attempted/failed/last-good be
  published even when a probe cannot complete. A new per-probe *payload* would need `state.ts`,
  `wire.ts`, the client's parser and types and a renderer — files outside this brief — and GPT Sol's
  P1 is that it is not achievable in the declared scope. What is already published is
  `attemptedAt` (set only when a child actually starts), `lastError` beside the retained previous
  snapshot, and a field-level `unknown` with a `why` on every reading. Stage 1's pid and duration go
  into those `why` sentences, so a refused or stuck probe is visible and attributed without a new
  channel. **This is the simpler product decision, named at the point of choosing** — if the Overseer
  or Greg wants per-probe telemetry on the page, it is a stage of its own with the renderer in scope.
- **`tools/fleet/probe-transcribe.ts` is out of scope.** The brief's file set names it, but it is a
  standalone paid transcription A/B CLI that never runs on the fleet request process; its one
  `readFileSync` reads a committed audio clip. GPT Sol's P3, and the same conclusion reached
  independently by reading it.

---

## Measurements

The instrument is `scripts/fleet-collect-bench.ts`. Nothing above may be claimed as an improvement
without a *before* and an *after* here.

### Baseline, 2026-09-10, before any change

Box: the Hetzner box, 16 cores, load average 5.4–6.0 (one run at 12.5), 24–25 tmux sessions with a
pane, 326 transcript files totalling 1.11 GB under `~/.claude/projects/`. Node v26.8.1.

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
| `statePayload()`, the per-*request* cost | 2.25 ms each, 59 KiB | — | — |

`/api/state` over the whole run, 1058 requests: median **1.9 ms**, p95 **530 ms**, max **1167 ms**.
*(This run predates the instrument's fixes; the corrected figures are below the fixture table.)*

**The per-request cost was measured rather than assumed**, because the plan's diagnosis rests on the
data already being collected. It is not free: `statePayload()` reads and projects the Overseer's
checkpoint file synchronously on every call and stringifies a 59 KiB payload, at **2.25 ms per
request**. Under 1% of the 250 ms target, so the diagnosis holds — but it is a floor no amount of
unblocking gets below, and at 40 requests a second it is 9% of a core. GPT Sol measured the same path
independently at median 1.85 ms / p95 2.86 ms over 500 calls with the real 114 KB checkpoint.

`npx tsx scripts/fleet-collect-bench.ts --mode=fixture --sessions=25 --probe-ms=30000` — the
acceptance case, on the controlled fixture, re-run on the **corrected instrument** (load 11.6):

| phase | wall | loop lag max | probes |
|---|---|---|---|
| `readPanes` over 25 rows, every capture a real child | 167 ms | 167 ms | 25 |
| `readPanes` over 25 rows, **one capture sleeps 30 s** | 30007 ms | 30007 ms | 25, 1 slow |

`/api/state` during it: median **29050 ms**, p95 **29945 ms**, max **30037 ms**.
**Accounting: 88 issued = 88 completed + 0 failed + 0 pending.**

The real-mode run on the same corrected instrument (load ~9, 24 sessions): median **5.1 ms**, p95
**903 ms**, max **1289 ms**, **950 issued = 950 completed**. The p95 is higher than the first,
censored run's 530 ms, which is the point — with the flight bounded and nothing dropped, the
requests that sat behind the block are all counted.

### What the baseline changed about the plan

- **The acceptance case is real and total.** A 30-second probe holds `/api/state` open for the full
  thirty seconds — not degraded, shut.
- **`collectHealth` is the single largest blocker at ~1.17 s per turn**, almost all of it
  `vmstat 1 2`; the same call without it is ~135 ms. Stage 2 therefore buys more on the normal case
  than Stage 3, and Stage 3 buys more on the bad case.
- **`collect()`'s synchronous tail is one ~470 ms block**, because the pane captures and the two `ps`
  calls run back to back with nothing awaited between them.
- **The inventory is 5.0 s and already async**, so the title grep costs freshness alone — which is
  what demoted Stage 4.
- **The real-box p95 is already far over the 250 ms target** — 530 ms censored, **903 ms** once
  every request is counted — before any fake probe is involved. The target is not slack.

### After Stages 1–3

Every figure below comes from `scripts/fleet-collect-bench.ts` on the corrected instrument, with each
run's requests accounted for; the tables and their exact commands are in the stage status blocks.

| what | before | after | where |
|---|---|---|---|
| **The acceptance case**: `/api/state` p95 while one of 25 captures takes 30 s | 30018 ms | **7.2 ms** | Stage 3, status — 3a |
| …and requests answered during those 30 s | 85 | **1209** | Stage 3, status — 3a |
| `collect()` end to end, loop lag max, real box | 409–478 ms | **28.1–31.6 ms** | Stage 3, status — 3b |
| The health turn, loop lag max, real box | 1159–1185 ms | **30–44 ms** | Stage 2, status |

The provisional target was a 250 ms p95 on the controlled fixture; the owned path is about 35× under
it. On the real box, **a production turn — collection plus health — no longer holds the request
thread for more than about 40 ms**, where it used to hold it for about 1.6 s every minute. Wall times
are essentially unchanged (the inventory script and `vmstat`'s sampling interval still take what they
take), and that was never the claim.

**Checked in production, read-only**: the Overseer's 09:44 restart put Stages 0–2 live, and one GET of
`/api/state` at 08:55 UTC showed all six health readings as values, a health turn of 1012 ms — the
owned gatherer's figure, not the synchronous 1160 ms — a fresh collection and no error.
