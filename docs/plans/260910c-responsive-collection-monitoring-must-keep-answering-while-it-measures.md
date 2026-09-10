# Responsive collection — monitoring must keep answering while it measures

**Status: Stage 0 done and measured; reviewed by GPT Sol and rewritten; Stages 1–4 to build.**
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
claim "the dashboard is responsive", because `drain.ts` can hold the same server in up to six
synchronous `execFileSync` tmux calls at ten seconds each — about 65 seconds — on any turn with
messages queued (`tools/fleet/drain.ts` header). That is delivery, not measuring, and it is
somebody else's stage. GPT Sol's finding.

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
- [ ] Once Stage 1 exists, drive the real `runOwned` path in the fixture rather than an injected
      `execFileSync("sleep")`.

## Stage 1 — Owned children: a probe you can stop waiting for and still be responsible for

New module `tools/fleet/child.ts`, importing nothing but node builtins.

- [ ] **`runOwned(spec)`** — `spawn`, stdout under a byte cap, and a lifecycle whose arms are
      distinguishable: `ok` / `failed` / `timed-out` / `refused` / `overflowed`. The caller is freed
      at `timeoutMs + graceMs` and not a millisecond later: SIGTERM at the deadline, SIGKILL a grace
      later, settle on `setImmediate` after it so an `exit` in the same tick still counts. **Not two
      graces in series** — `scripts/subagent-cli.ts`'s GPT Sol F11 is exactly that mistake.
- [ ] **`stuck` is decided on `exit`, NEVER on `close`** — GPT Sol's P1, and the plan had it wrong.
      `exit` says the process is gone; `close` also waits for everything holding its stdout and
      stderr pipes, so a helper that escaped into another group keeps `close` pending after the child
      is dead. Defining `stuck` by `close` would report a dead child as stuck and **refuse that probe
      for ever**. So: listen to both, start a bounded pipe-flush grace from `exit`, destroy the read
      streams when it expires, and let `exit` alone decide whether the process is still with us.
- [ ] **The group proof is captured at spawn, not at the kill.** GPT Sol's second P1 here: by the
      time we want to signal, `/proc/<leader>/stat` may be gone while its descendants are alive, and
      a proof that cannot be re-taken is a fallback to signalling a dead pid and leaking the rest. So
      immediately after `spawn` (`detached: true`, which makes the child its own group leader) read
      `/proc/<pid>/stat` once and keep **both** the process-group id and the **start time** — start
      time because a pid consulted later may name a stranger (`tools/overseer/work.ts` says so
      already). Signal the group only when the recorded pgrp equals the pid *and* the live start time
      still matches; otherwise signal the pid alone and say which in the `why`.
      `/proc/<pid>/stat`'s `comm` field is parenthesised and may contain spaces and parentheses, so
      parse the fields after the **last** `)`.
- [ ] **`refused` is how "repeated timeouts do not multiply live owned children" is enforced**, and
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
- [ ] **Everything `subagent-cli.ts` paid for, restated here so it is not paid twice:** fd 0 never
      inherited (`"ignore"`); the child's `error` event handled, so a spawn failure is a `failed`
      value and never a throw; pipes drained or destroyed after overflow and after exit; UTF-8
      decoded through `StringDecoder`; the parent's own `SIGTERM`/`SIGINT` forwarded to detached
      children, or a dashboard restart orphans them; and descendants swept even when the leader
      exits cleanly.
- [ ] **`limit(n)`**, a small concurrency limiter, so cheap independent probes run a few at a time
      rather than one child per session at once.
- [ ] **Tests, red first**, driven by a fake spawn where a real process cannot make the case: a clean
      exit; a non-zero exit; `ENOENT`; a child that ignores SIGTERM and dies on SIGKILL (real:
      `sh -c 'trap "" TERM; sleep 30'`) settling at about `timeout + grace`; a child that never exits
      (fake — SIGKILL is uncatchable, so an unkillable child cannot be manufactured, and the comment
      must say so) staying in `live()` and refusing the next call for its key while spawning nothing;
      **a child whose `exit` fired but whose `close` has not, which must NOT be stuck**; a different
      key running while the first is refused; a late exit clearing the refusal; the group proof in
      its three outcomes; `/proc` parsing with a `comm` containing a space and a `)`; overflow
      settling; and `limit(2)` never exceeding two.

## Stage 2 — Health off the request thread

- [ ] **Split the assembly from the gathering.** `assembleHealth(reads)` takes the seven command
      outcomes and returns the `HealthReport`. One place decides what a reading means.
- [ ] **`collectHealthAsync(owner, options)`** gathers through `runOwned` under `limit(3)`, with
      `vmstat 1 2` on its own longer bound. **The synchronous `collectHealth` stays, over the same
      `assembleHealth`** — `routes-new.ts` and `scripts/readiness-loop.ts` are other people's files
      and keep working untouched. A test asserts the two gatherers produce an **identical report**
      from identical command output, so they cannot drift.
- [ ] **Health failure stays separate from fleet failure** (`refreshOnce` already does this), a
      `refused` or `timed-out` probe becomes that field's `unknown` **with the pid and the duration
      in the `why`**, and **swap's since-boot first sample stays excluded** — a test pins that.
- [ ] `RefreshDeps.refreshHealth` becomes `() => Promise<HealthTurn>`; `server.ts` awaits it.
- [ ] **Recorded, not fixed:** `routes-new.ts:741` still calls the synchronous quick health
      (~135 ms measured) on the request process when a new session is created. It is a route file and
      not ours; it is a rare, deliberate, user-initiated request rather than a per-minute poll; and
      the async collector is now there for its owner to adopt.

## Stage 3 — The tmux probes, the pane pass, and the process table

- [ ] `capturePaneAsync` beside `capturePane` in `pane.ts` (the sync one stays — `steer.ts` uses it),
      and `readPanes` becomes async over `limit(4)`. `tests/fleet-launch-mode.test.ts` drives
      `readPanes` at four call sites and must be updated with it.
- [ ] `panes()` and `generationNow()` go through the owner. Their bargains are unchanged: an
      unreadable listing is an empty map, an unreadable generation is `null` meaning *unverifiable*,
      and only two numbers that disagree are drift.
- [ ] **`readExecutions`' two `ps` calls, which are no longer optional.** GPT Sol's P1: at 186–199 ms
      measured, against a 470 ms synchronous tail and a 250 ms target, they are responsiveness work.
      It needs the "is this a reading of THIS machine" positive control inside `probeProcessTable`
      reachable from an already-fetched stdout — **a pure extraction in
      `tools/overseer/work-probe.ts`, authorised by the Overseer on 2026-09-10** on these conditions:
      no behaviour change, `probeProcessTable` calls the extracted function so the checks stay in one
      copy, and **a test that drives the extracted function alone with a foreign process table and
      watches it refuse** — the positive control has to be shown firing from the new entry point, not
      only from the old one.
- [ ] **Per-field unknowns are preserved**, and each now says which kind of not-looking it was: a
      pane not reached because its probe was refused behind a stuck child reads differently from a
      pane whose capture failed.
- [ ] Re-run the bench with the fixed accounting. Before/after in this file, or no claim.

## Stage 4 — The title lookup

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

*(to be filled in, with the fixed request accounting)*
