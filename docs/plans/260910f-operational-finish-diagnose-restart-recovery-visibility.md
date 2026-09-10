# Operational finish: diagnose, restart and recovery visibility

Queue item `qi-24bxpbxe`, dispatched by the Overseer on 2026-09-10. The spec is the roadmap stage
[260908f § Stage: Operational finish](260908f-overseer-and-fleet-improvement-roadmap.md#stage-operational-finish--prove-failure-restart-and-recovery-visibility):
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

- [ ] `tools/fleet/revision.ts`: `readStartRevision(dir, run)`, injected `run` for tests; unknown on
  any git failure, with the reason. Red first: a test that a dirty tree reports dirty, and that the
  value does not change when HEAD moves after the read.
- [ ] Daemon: optional `revision` on `daemon-started`, parsed tolerantly; `DaemonOptions.revision`
  injectable. Red first in `overseer-daemon.test.ts`'s harness.
- [ ] Dashboard: stamp captured once at startup in `server.ts`.
- [ ] Client: `__FLEET_BUILD__` + `dist/build-stamp.json`. Red first: a test that builds a stamp
  from a fake run and that the server-side reader treats a missing/malformed stamp file as unknown.

### Stage 2 — `overseer diagnose`

- [ ] `tools/overseer/diagnose.ts`: composes the daemon's standing (`daemonStanding`), its start
  revision (last `daemon-started` of the checkpoint's instance), checkpoint schema vs `STORE_SCHEMA`,
  the two clocks and their ages, recorded vs host boot id, every store file via `store-probe.ts`,
  held vs built job list (`schedulePreviewLines`' comparison), and the dashboard's
  `/api/diagnostics` — or *unreachable*, which is a line, not a crash.
- [ ] Revision verdicts per service: *same as this checkout's HEAD*, *N commits behind HEAD*,
  *not an ancestor of HEAD*, *dirty at start*, *not stamped*, *unknown*. Never *same* from absence.
- [ ] `scripts/overseer.ts diagnose [--json]`. Tests on a scratch store built by the real daemon.

### Stage 3 — Web summary

- [ ] `DiagnosticsSummary` in `wire.ts`; `routes-diagnostics.ts` with a runtime parser at the client
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

- [ ] **Dashboard, a real process** (`tests/fleet-server-process.test.ts`): spawn `server.ts` on a
  free port with every `FLEET_*`/`OVERSEER_*` path pointed at a scratch dir (the env list
  `fleet-decisions-route.test.ts` sets), `TMUX` unset and `TMUX_TMPDIR` a scratch dir (the collector
  has no socket override, so the default socket then names an empty server rather than the live
  fleet), and `FLEET_DESCRIBE_MAX_CALLS=0` so it makes no model call. (a) SIGKILL,
  respawn: a new `instance`, `/api/diagnostics` answers with a fresh `attemptedAt`. (b) Missing
  client build: exits 2 with the sentence, needs a `FLEET_DIST` override (one line in `server.ts`;
  today `DIST` is fixed beside the file). (c) Failed bind: a port already held, exits 1.
- [ ] **Daemon over a source that dies and returns**: real `runOverseer` wired to the real
  `source.ts` over `overseer-source.test.ts`'s `fakeFleet` stand-in, which is closed and then
  reopened: `condition-degraded` is written, then `condition-restored`, and `diagnose` on that store
  shows the stopped `lastGoodSnapshotAt` while the heartbeat still moves — the *deaf* control the
  acceptance paragraph asks for.
- [ ] **Restart without double dispatch**: two real `runOverseer` runs on one root with the same
  `jobs`, the first aborted mid-lease; the second makes no dispatch and writes the unknown down.
- [ ] **A killed daemon process** — only if `overseer run` can be started with no outbound calls
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
(bogus host) → the watchdog logs the failed ping locally and exits non-zero, and the service alerts
because pings stopped — the monitor's own failure fails loud. Then the real check, and one
deliberate alert end to end, repeated monthly.

**What it needs from Greg**: pick A, B or C (and for A, Pushover or ntfy); authorise creating the
account/check; say now, provisioning, or both for the timer unit and the secret file — the box's own
rule ([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file)).

## Status

2026-09-10: plan drafted; census and destination research in flight.
