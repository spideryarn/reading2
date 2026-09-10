# Operational finish: diagnose, restart and recovery visibility

Queue item `qi-24bxpbxe`, dispatched by the Overseer on 2026-09-10. The spec is the roadmap stage
[260908f § Stage: Operational finish](260908f-overseer-and-fleet-improvement-roadmap.md#stage-operational-finish-prove-failure-restart-and-recovery-visibility):
its checkboxes and acceptance paragraph. This plan builds the first, the relevant half of the
third, and writes the fourth as a proposal. Worktree `ops-diagnose`, session of the same name.

## What this is for

Two services carry the Overseer: the fleet dashboard (`fleet-dashboard.service`, systemd) and the
Overseer daemon (a hand-started tmux job today). Nobody can answer, in one command, *which revision
is each running, which checkpoint schema, how old is each clock, and does the daemon hold the job
list this checkout builds*. Crash-and-restart is exercised by hand. And a failure of the box itself is
invisible, because every monitor lives on it (A27 in
[overseer-direction.md](../project/overseer-direction.md)).

## What exists, and the gap that decides the shape

Read-only census, 2026-09-10:

- **Instance ids exist; revisions do not.** The dashboard mints `serverInstanceId()` per run
  (`tools/fleet/instance.ts`) and stamps every payload with a `ProducerStamp`; the daemon's
  checkpoint heartbeat carries `pid`, `instanceId`, `startedAt`, `lastTickAt`, `ticks`. **Neither
  records the git revision it was started from**, and the client bundle carries nothing but vite's
  content hash in a filename — the roadmap's 2026-09-08 runtime record says so, and it is still true.
- **The job-list comparison already exists** — `overseer status` prints `schedulePreviewLines`, which
  compares the daemon's `schedule.json` `list.listRevision` with the list this checkout builds.
  Diagnose reuses it; it does not re-derive it.
- **The daemon's standing** (running / stalled / stopped / killed / cannot-tell) is `daemonStanding`
  in `status-cli.ts`; the two clocks and their four failure states are `overseer-watchdog.ts`'s.
  Reused, not copied.
- **Boot id**: the recovery file records the boot the daemon last saw (`recovery.json` `bootId`);
  the host's is `/proc/sys/kernel/random/boot_id`.
- **Store files** under `~/.overseer`: `current.json` (schema 2), `recovery.json` (1), `events.jsonl`,
  `daemon.jsonl`, `schedule.json` (1), `attention.json`, `usage.jsonl`, `reports.jsonl` (1),
  `decisions.jsonl` (2), `queue.jsonl` (1), `cli-state.json` (1), `descriptions.json` (1),
  `last-snapshot.json`, `overseer.lock`, plus the report inbox directories.

**The one inference this plan refuses:** reading the running revision off the checkout's `HEAD`.
The roadmap says so in as many words — *do not claim client+server revisions match merely because
HEAD matches* — and on this box the primary moves under a running service several times an hour.
A process that did not record its revision at start has an **unknown** revision, and the page says
so. (The simpler option passed over: infer it from `git reflog` at the process's start time. It is
cheaper today, and it is a guess about which files `tsx` had loaded, rendered as a fact.)

So the stamp comes first, and everything else reads it.

## Decisions

- **D1. Stamp at start, read once.** Each process reads `git rev-parse HEAD` plus a dirty flag of the
  checkout its own code sits in, **once, at startup**, and never again. A stamp read lazily on first
  request is the current HEAD, not the running code. One leaf, `tools/fleet/revision.ts`, used by both
  services — fleet-owned because `tools/fleet/` may not import `tools/overseer/`.
  `{kind:"known", sha, dirty, readAt} | {kind:"unknown", why}`. Dirty is reported, never hidden: a
  dirty start means the sha does not name the running code.
- **D2. The daemon's stamp goes in its `daemon-started` note**, as an optional `revision` field. No
  schema bump by the notes file's own rule — a reader ignoring it draws no wrong conclusion — and a
  note written before this lands reads as *not stamped (started before revision stamps existed)*,
  which is exactly what the live daemon will say until the Overseer restarts it.
- **D3. The client's stamp is compiled in and written beside the bundle.** `vite.fleet.config.ts`
  defines `__FLEET_BUILD__` (sha, dirty, builtAt) and writes `dist/build-stamp.json`. Three facts,
  kept separate: what the server started from, what bundle is on disk now (server reads the stamp file
  per request), and what bundle this browser tab is running (compiled in). Mismatch is displayed;
  absence is *unknown*, never *same*.
- **D4. `overseer diagnose` is a report, not a gate.** Exit 0 when it rendered, 1 when it could not
  read the store at all. Mismatches and unknowns are lines, not exit codes — `fleet-restart.ts`
  is the gate. `--json` for a machine reader.
- **D5. The web summary is fleet-owned and reads files, not the Overseer's modules.** A route
  `GET /api/diagnostics` (`tools/fleet/routes-diagnostics.ts`) returns a `DiagnosticsSummary`
  (appended to `wire.ts`): the dashboard's own start stamp, the on-disk bundle stamp, its collector
  clocks (`attemptedAt`, `collectedAt`, last error), and a generic probe of each store file (exists,
  size, mtime age, top-level `schema`, torn JSONL tail). What only the Overseer's code can answer —
  whether the daemon's held list is the one this checkout builds, the checkpoint's parse under
  `STORE_SCHEMA` — the page names as *answered by `overseer diagnose`* rather than guessing.
- **D6. Tests on scratch instances only**: a scratch store (the recovery drill's pattern), a
  scripted source, a free port, a disposable directory. Never the live store, the live dashboard, or
  the live daemon.
- **D7. The dead-man monitor is a proposal.** Greg picks and authorises the destination; nothing
  pings anywhere until then.

## File set

Mine: `tools/fleet/revision.ts`, `tools/fleet/store-probe.ts`, `tools/fleet/routes-diagnostics.ts`,
`tools/overseer/diagnose.ts`, the `diagnose` entry in `scripts/overseer.ts`, a `DiagnosticsSummary`
block appended to `tools/fleet/wire.ts`, `tools/fleet/web/src/DiagnosticsSection.tsx` +
`diagnostics-client.ts`, tests.

**Outside the brief's set, and each a few lines** (named here so the review can object):
`tools/fleet/server.ts` (capture the stamp at start, mount the route), `vite.fleet.config.ts` (the
build stamp), `tools/overseer/notes.ts` + one field in `daemon.ts`'s `daemon-started` write (not the
usage pass), and a one-line mount of the section in the Box health panel. Not touched: `infra/`,
systemd units, the usage pass, the attention pass, `launch*`, `OverseerPanel.tsx`, the composers.

## Stages

### Stage 1 — Revision stamps

**Status, 2026-09-10: built and committed (`cb4c3ba7`), implemented by an Opus subagent; Sol stage
review running (findings-only, because three agents share this tree).** Started before the plan
review returned, for speed; reworked if that review touches D1–D3.

- [x] `tools/fleet/revision.ts`: `readStartRevision(dir, run)`, injected `run` for tests; unknown on
  any git failure, with the reason. Red first: a test that a dirty tree reports dirty, and that the
  value does not change when HEAD moves after the read.
- [x] Daemon: optional `revision` on `daemon-started`, parsed tolerantly; `DaemonOptions.revision`
  injectable. Red first in `overseer-daemon.test.ts`'s harness.
- [x] Dashboard: stamp captured once at startup in `server.ts`.
- [x] Client: `__FLEET_BUILD__` + `dist/build-stamp.json`. Red first: a test that builds a stamp
  from a fake run and that the server-side reader treats a missing/malformed stamp file as unknown.

**Stage review (GPT Sol, findings-only, at `cb4c3ba7`): refuse, on established P1s; no P0.** Answer
in `260910f-…stage1-review-answer.md`. Each finding was established by a scratch-repository run or a
control-flow trace, and all four are accepted; an Opus subagent fixes them.

| ID | Finding, short | Disposition |
|----|----------------|-------------|
| S1-F1 | `dirty` does not say whether the sha names the running code: an untracked imported file or an `assume-unchanged` flag stamps clean; an unrelated tracked Markdown edit stamps dirty | **Accepted as wording, no rename.** Every description of `dirty` now says only what git status reported about tracked files; neither value proves which bytes loaded. Rendering already never says "running code is" (plan-review F1). Scoping untracked files to `tools/`/`scripts/`/`src/` rejected as certification, per the reviewer: imports cross those boundaries |
| S1-F2 | sha and cleanliness come from two git processes, so a commit landing between them pairs A's sha with B's cleanliness | **Fixed:** one `git status --porcelain=v2 --branch` call gives both (`branch.oid` plus change lines) |
| S1-F3 | `vite build --watch` resolves the config once, so every rebuild carries the first build's stamp | **Fixed, smallest:** the config refuses watch mode with a sentence; the stamp is described as "checkout observed when the config loaded" |
| S1-F4 (P2) | a malformed `readAt`/`builtAt` still reads as a known stamp | **Fixed:** finite ISO instants required; invalid-date cases in both readers' tests |

**What the plan did not know.** Tracked-only dirtiness has a hole: a commit can import a file its
author never added, and a checkout still holding it untracked stamps clean — the reason
`readiness-git.ts`'s `stampTree` counts untracked files. Counting every untracked file in the
primary makes dirty always true. Put to the stage review; the gap is written into `revision.ts`'s
doc comment meanwhile. Also: every existing daemon test now reads real git once, because start notes
carry a real revision by default.

### Stage 2 — `overseer diagnose`

**Status, 2026-09-10: built (Opus subagent), 31 tests, typecheck 0; Sol stage review next.** Live
read-only smoke: the running daemon reads *not stamped*, as it must until the Overseer restarts it;
the held job list matches this checkout's.

**What the plan did not know.** (1) A file has a *set* of schemas this build reads, not one:
`decisions.jsonl` is schema 1 on the live store and `DECISIONS_SCHEMA` is 2, with 1 still read as
`LEGACY_DECISIONS_SCHEMA` — a single number would flag a false mismatch. (2) `usage.jsonl` names its
field `lineSchema`, so the probe takes a field name per file. (3) `last-snapshot.json`'s schema 1 is a
bare literal in `daemon.ts`, so it shows *no known schema*. (4) An unusable checkpoint names no
instance, so no start revision is shown; the lock file's `instanceId` could fill that and does not
yet. (5) The "cannot tell" rule for incomplete notes lived inside `statusLines`; it is now the
exported `standingFromReads`, shared by `status` and `diagnose`.

**Stage review (GPT Sol, findings-only, at `3c69ddcd`): request changes, six established P1s, no
P0.** Answer in `260910f-…stage2-review-answer.md`. It confirmed the command only reads — no locks,
no torn-tail repair, no import side effects — and that a final JSONL line longer than the tail window
fails safely to unknown. All six accepted; an Opus subagent fixes them.

| ID | Finding, short | Disposition |
|----|----------------|-------------|
| F40 | job files that fail to load are hashed as an empty list, so it prints "the same list this checkout builds" | **Fix:** the built list is `built | unbuildable`; unbuildable is never hashed or compared. `status` checked for the same discard |
| F41 | a valid legacy `cli-state.json` with no `schema` reads as a mismatch | **Fix:** per-file accepted legacy formats, never a global "undeclared matches" |
| F42 | "every store file" is a fixed list missing `armed.json`, `usage.prev.jsonl`, `reconcile-occurrences.json`, the locks and `.created` markers | **Fix:** the union of the catalogue and a bounded `readdir`; unknown names still get a row |
| F43 | a checkpoint dated in the future reads RUNNING ("last written in the future ago") | **Fix:** a future clock is `cannot-tell`, before liveness, in `status` too |
| F44 | a boot mismatch claims "the daemon has not run since the reboot"; `recovery.json` only moves after an accepted collection | **Fix:** say only that `recovery.json` has not yet recorded the current boot |
| F45 | RUNNING rests on the pid existing; pid reuse turns a killed daemon into a running one (the same gap Stage 4c named) | **Fix:** the live pid's `/proc` start time must fall within 120 s before `heartbeat.startedAt`, reusing the existing stat reader; unverifiable is not RUNNING |

- [x] `tools/overseer/diagnose.ts`: composes the daemon's standing (`daemonStanding`), its start
  revision (last `daemon-started` of the checkpoint's instance), checkpoint schema vs `STORE_SCHEMA`,
  the two clocks and their ages, recorded vs host boot id, every store file via `store-probe.ts`,
  held vs built job list (`schedulePreviewLines`' comparison), and the dashboard's
  `/api/diagnostics` — or *unreachable*, which is a line, not a crash.
- [ ] Revision verdicts per service: *same as this checkout's HEAD*, *N commits behind HEAD*,
  *not an ancestor of HEAD*, *dirty at start*, *not stamped*, *unknown*. Never *same* from absence.
- [ ] `scripts/overseer.ts diagnose [--json]`. Tests on a scratch store built by the real daemon.

### Stage 3 — Web summary

**Status, 2026-09-10: built (Opus subagent), with F2, F4 and F8 folded in; `server.ts` wired by hand
because the agent held off while another was editing it. 70/70 across six fleet suites; `build:fleet`
0. Browser check and stage review wait on the Overseer's pause (the account's five-hour window).**

**What the plan did not know.** (1) The runtime parser cannot live in the client file: the node
tsconfig would type-check any browser file `diagnose.ts` imports, so it sits in
`diagnostics-parse.ts` and the client re-exports it. (2) A fixed allow-list that refuses every other
name would contradict F42 (a row for every entry), so allow-listed names are read and any other
plain name is only `lstat`ed. (3) **The old probe hung for ever on a FIFO** — `openSync` blocks; it
now opens `O_NOFOLLOW | O_NONBLOCK` after an `lstat`. (4) The JSON ceiling is 1 MB, not 4; the
largest live file is ~110 KB. (5) App-level panel tests now make one failing relative `fetch`,
because `App` does not pass the section an api — harmless, and threading one through is a small
follow-up.

- [x] `DiagnosticsSummary` in `wire.ts`; `routes-diagnostics.ts` with a runtime parser at the client
  boundary; `DiagnosticsSection.tsx` in Box health: each service's revision and verdict, the bundle
  this tab runs vs the bundle on disk vs the one the server started with, collector clocks, store
  files. Browser check at desktop and phone widths on a fixture-backed server (Sonnet subagent).

### Stage 4 — Crash and restart on scratch instances

**Census (Explore subagent, 2026-09-10).** Most boundaries are covered at function or store level;
only stale heartbeat and a throwing source run on a real service instance. Covered and not repeated:
store-level torn tails and bad checkpoints (`overseer-store.test.ts`, `overseer-notes.test.ts`,
`fleet-receipt-restart.test.ts`), in-process daemon crash points (`overseer-daemon-recovery.test.ts`
§ crashes), the store lock (`overseer-store.test.ts` :672–832), dashboard exactly-once delivery
across a restart (`fleet-receipt-restart`, `fleet-direct-steer-restart`), and the dashboard reading
a stopped heartbeat (`fleet-overseer-status.test.ts`). **No test starts `server.ts` as a process,
and no test runs the daemon twice with jobs.** The gaps, each a new test on scratch state:

- [x] **Dashboard, a real process** (`tests/fleet-server-process.test.ts`, Opus subagent; 5/5 on three
  runs; reads `/api/state`'s producer stamp, since `/api/diagnostics` did not exist yet; also found
  the collector runs `claude agents --json`, so a stub `claude` leads `PATH`, and that a test
  worker's environment carries `.env.local`, so the child's env is built, not inherited): spawn `server.ts` on a
  free port with every `FLEET_*`/`OVERSEER_*` path pointed at a scratch dir (the env list
  `fleet-decisions-route.test.ts` sets), `TMUX` unset and `TMUX_TMPDIR` a scratch dir (the collector
  has no socket override, so the default socket then names an empty server rather than the live
  fleet), and `FLEET_DESCRIBE_MAX_CALLS=0` so it makes no model call. (a) SIGKILL,
  respawn: a new `instance`, `/api/diagnostics` answers with a fresh `attemptedAt`. (b) Missing
  client build: exits 2 with the sentence, needs a `FLEET_DIST` override (one line in `server.ts`;
  today `DIST` is fixed beside the file). (c) Failed bind: a port already held, exits 1.
- [x] **Daemon over a source that dies and returns** (`tests/overseer-daemon-source-outage.test.ts`,
  Opus subagent; asserted on the checkpoint and notes, since `diagnose` did not exist yet — seen red
  with the heartbeat stopped and with the dashboard never returning): real `runOverseer` wired to the real
  `source.ts` over `overseer-source.test.ts`'s `fakeFleet` stand-in, which is closed and then
  reopened: `condition-degraded` is written, then `condition-restored`, and `diagnose` on that store
  shows the stopped `lastGoodSnapshotAt` while the heartbeat still moves — the *deaf* control the
  acceptance paragraph asks for.
- [x] **Restart without double dispatch** (`tests/overseer-daemon-restart-no-double-dispatch.test.ts`,
  Opus subagent): two real `runOverseer` runs on one root with the same `jobs`. **The invariant is
  "the same occurrence is never dispatched twice", not "the counter never moves"** — the plan's first
  wording was wrong: an occurrence written down as unknown holds nothing up, so the job's *next*
  occurrence rightly runs. Inside the lease the correct state is `started` (the child may outlive the
  daemon); the unknown and its `lease-expired` note appear only once the lease runs out, and the test
  asserts both phases. A spawn-window crash (lock overwritten by a dead pid from inside the
  dispatcher) records `reservation-abandoned`; a clean control proves a genuinely new occurrence runs
  exactly once. Each seen red on a one-line mutant.
- [x] **A killed daemon process — made required by F6, built** (`tests/overseer-daemon-process.test.ts`,
  Opus subagent, 3/3): `--no-attention --no-usage` both exist and the child's output is asserted to
  say so; jobs and rules disarmed; SIGKILL → `diagnose` says KILLED; a second child takes the dead
  pid's lock; SIGTERM → stop note, lock released, *stopped*. **Known limit:** *killed* rests on the
  pid being gone, so a reused pid reads as running or stalled. The outage test was strengthened for
  F7 in the same stage. Original wording, kept for the record: only if `overseer run` can be started with no outbound calls
  (no model, no usage fetch, jobs disarmed); otherwise the in-process crash tests stand and this is
  recorded here. SIGKILL the child, `diagnose` says *killed*, a second child takes the lock.
- [ ] **Stopped clock observed**: `diagnose` on a scratch store whose daemon stopped reports the
  stale heartbeat, and on one with an unparseable checkpoint reports *cannot tell*, not *absent*.

### Stage 5 — Off-box dead-man proposal

**A proposal, not a build.** Nothing pings anywhere until Greg picks a destination and says whether
the host change goes in now, into provisioning, or both. Research: a general-purpose subagent read
each service's own pricing and docs pages on 2026-09-10; URLs below, and what it could not verify
is marked.

**Why off-box at all.** `overseer-watchdog.timer` already tells stopped from deaf from unreadable,
and it dies with the box. A dead-man check inverts the direction: the box *pushes* a ping every few
minutes, and a service somewhere else raises the alarm when the pings **stop**. So a box that lost
power, its disk, its network or its kernel fails loud, through a channel that survives it.

**The pinger, whichever destination.** Reuse the watchdog rather than write a second judge: one new
flag on `scripts/overseer-watchdog.ts` (`--ping <url-file>`) that, after its existing assessment,
sends `ok` to the check's URL, or `/fail` with the state word (`stale`, `deaf`, `unreadable`,
`no-checkpoint`) and a reason from a fixed vocabulary. **No session names, no transcript text, no
paths**: the body is stored and shown on a third party's dashboard. The check URL is a secret in a
`0600` file outside the repo. Every 5 minutes, grace 10 minutes: an alert within 15 minutes of the
box going silent, and one missed ping (a slow tick, a blip) does not page anyone. Notifications:
**host down or Overseer stale/deaf/unreadable only** — never per blocked agent, which is the
roadmap's rule.

| | **A. Healthchecks.io** (recommended) | B. Better Stack Uptime | C. Cronitor |
|---|---|---|---|
| Cost | Free: 20 checks. $5/mo "Supporter" is the same limits, as a donation | Free: 10 heartbeats. Paid from $29/mo (annual) | Free: 5 monitors. $2/monitor/mo + $5/user |
| Reaches Greg's phone on free | Pushover (one-off app purchase) or ntfy (free), plus email, Slack, Telegram, Signal. No iOS app of its own | Email and Slack stated; iOS push/phone on free **could not be confirmed** | Email, Slack; no SMS |
| Explicit failure + reason | `/fail`, body stored (first 100 kB, last 100 entries on free) | `/fail` + exit code; body retention **not documented** | `state=fail` + message ≤ 2000 chars, stored |
| Data location | EU (Hetzner), open source (BSD-3), self-hostable later | EU by default | US |
| Gotcha | Ping needs no key; the check id in the URL is the secret | Pending until the first ping | **The ping URL carries the account API key** — a leaked unit file is a leaked account |

Sources: healthchecks.io/pricing, /docs/http_api, /privacy, /docs/self_hosted;
betterstack.com/uptime/pricing, /docs/uptime/cron-and-heartbeat-monitor; cronitor.io/pricing,
/docs/heartbeat-monitoring. (UptimeRobot and Dead Man's Snitch were looked at and dropped: the
first's heartbeat docs say nothing about failure signals or bodies, the second's free tier is one
check.)

**What any of them can and cannot see.** It sees *the box stopped saying it was fine*, and — with the
watchdog's verdict in the ping — *the box says the Overseer is stale, deaf or unreadable*. It
**cannot** tell a dead box from a network or Tailscale outage (both are silence); cannot see a wedged
daemon unless the watchdog's own clocks catch it (they do: that is what `stale` is); cannot see the
dashboard hung while its process lives beyond what the checkpoint's `lastGoodSnapshotAt` shows; and
the external service can itself fail quietly or its alert be muted on the phone — hence the monthly
end-to-end test below.

**Test plan, once a destination is chosen.** On a disposable check, never the real one: (1) ping
`ok` from a scratch timer → the check goes green; (2) stop the timer → one alert within period +
grace, and exactly one (dedup is the service's, per state change); (3) resume → one recovery
notice; (4) point the watchdog at a scratch store with a stopped heartbeat → a `/fail` with body
`stale`, and the body contains nothing but the vocabulary; (5) make the destination unreachable
from the disposable pinger → it logs the failed delivery locally and exits non-zero; if the
provider remains healthy, its missing-ping alert proves a host-to-provider delivery failure is
visible. This does **not** test a provider outage: the provider or the notification channel failing
remains a stated residual risk, covered only by the monthly end-to-end test or by a separately
authorised independent monitor (Sol's F9). Then the real check, and one
deliberate alert end to end, repeated monthly.

**What it needs from Greg**: pick A, B or C (and for A, Pushover or ntfy); authorise creating the
account/check; say now, provisioning, or both for the timer unit and the secret file — the box's own
rule ([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file)).

## Plan review (GPT Sol, `--sandbox review`, at `2c751326`)

Verdict *request changes*: established P1s F1, F2, F3, F5, F6; no P0. The answer is
`260910f-…plan-review-answer.md` beside this file (the reviewer could not write the separate
findings file from its sandbox and put them in the answer instead). Stage 1 had started before it
returned. Every finding accepted; where it lands:

| ID | Finding, short | Disposition |
|----|----------------|-------------|
| F1 | A start stamp names the checkout, not the loaded bytes; dirty starts typed `known`; "same" reads as "the running code is" | **Accepted, as wording.** D1 now reads: *a stamp is a checkout observation at start, not a code identity.* A dirty stamp renders `code revision unknown — base HEAD <sha>, checkout dirty at start`; a clean one only as `recorded start HEAD matches / is N behind / is not an ancestor of this checkout's HEAD`. No text says the running code or bundle *is* a revision. The type keeps `known` (renaming it is churn with no reader change); fixed in `diagnose.ts` and the page |
| F2 | D5's payload cannot serve Stage 3: no daemon start stamp, no bundle stamp at server start, no store-path label, no health age | **Accepted.** D5 amended as the reviewer wrote it: add the client build stamp captured once before listeners open, the latest health-reading age, the resolved store-path label, and the daemon's start stamp from a fleet-owned tolerant reader of `daemon.jsonl` correlated to the checkpoint's `instanceId`. `HealthPanel.tsx` named in the file set |
| F3 | `daemonStanding` pairs one global last note with the checkpoint: A checkpointed and was killed, B started and stopped cleanly → A's checkpoint with B's clean stop | **Accepted, a real bug in shared code** (now reached by `status` and `diagnose` both). Standing resolves from start/stop correlated by `instanceId`; regression test is the reviewer's scenario. `status-cli.ts` and `tests/overseer-cli.test.ts` added to the file set |
| F4 | The dashboard read in `diagnose` has no deadline or body bound | **Accepted**, in Stage 3 where the route exists: injected `fetch`, 5 s `AbortSignal`, bounded body, non-2xx and malformed JSON each a named `unusable` line |
| F5 | The spawned-server test is not isolated: readiness scans `process.cwd()`'s job logs at start; `openRouterKey()` reads the real `.env.local` before the zero budget; `OVERSEER_QUEUE_DIR` omitted | **Accepted**, relayed to the Stage 4b agent before it spawned anything: disposable git checkout as `cwd`, an invalid `OPENROUTER_API_KEY` sentinel, the reviewer's env list, and an assertion that every resolved path is beneath scratch |
| F6 | The killed-daemon process test is optional; an aborted `runOverseer` is a graceful stop, not a crash | **Accepted — now required** (Stage 4c): `overseer run --no-attention --no-usage`, jobs and rules disabled, scratch everything, SIGKILL, `diagnose` says killed, a second child takes the lock |
| F7 | The outage test must see a *moving* source clock stop, not start from null | **Accepted** (Stage 4c): assert non-null `t0` before the outage, `t0` held across ≥ 2 later checkpoints, `t1 > t0` after, and `diagnose` renders the stopped clock |
| F8 | The per-request probe has no byte, file-type or symlink contract | **Accepted** (Stage 3, `store-probe.ts`): fixed allow-list, `lstat`, symlinks and non-regular files reported not followed, a JSON byte ceiling, JSONL tail-only |
| F9 | Stage 5 item 5 claims more than it tests | **Accepted**; item 5 reworded below |

## Status

2026-09-10, ~19:56 UTC. **Every stage is built and committed** in the worktree: the Stage 1 review's
fixes (`bfc0c3bf`), the plan review's F3/F1 (`52267541`), Stage 4c (`41508b7d`), and Stage 3 with the
Stage 2 review's six P1 fixes (`b5bdea14` — one commit because they share files). `dev` merged in
(19 commits, no conflicts), typecheck 0, full suite running on the merged tree. Paused by the
Overseer at ~19:40 for the account's five-hour window: the narrow Sol check of the ten P1 fixes, the
Fable pass, the browser check and the debrief wait for its resume. The live daemon was restarted by
the Overseer meanwhile and now shows a recorded start HEAD; the live dashboard answers 404 on
`/api/diagnostics` until it is restarted onto this code.

Earlier, ~19:30 UTC. On `dev` (`6e0d42c0`): the plan and its review dispositions, Stage 1
(`cb4c3ba7`), Stage 2 (`3c69ddcd`), Stage 4a (`349def9c`) and Stage 4b (`e7f39e4e`). In flight: the
Stage 1 review's fixes (S1-F1–F4), the plan review's F3 standing fix and F1 wording, Stage 3 (the
web summary, with F2/F4/F8), Stage 4c (killed daemon process, F6; the outage test strengthened,
F7), and Sol's Stage 2 review. Then one narrow Sol check of the P1 fixes, and Fable. **No live
restart has been done or is needed by this branch until it is finished**; when it is, both the
dashboard and the daemon need one for their revision stamps to appear — the Overseer's to arrange.
