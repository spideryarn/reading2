# The Overseer's store, and the clock it gives everything else

**Status: planned, nothing built.** Evidence: there is no `tools/overseer/`.

The standing direction is [orchestrator-direction.md](../project/orchestrator-direction.md) — read it
first; it holds the constraints, Greg's horizon, and the seam with the fleet dashboard, and it
outlives this file. The dashboard's own plan is
[260907e-agent-fleet-dashboard.md](260907e-agent-fleet-dashboard.md), built by a different agent at
the same time as this.

This is **stage O1** of the Overseer. It builds the store and nothing else: no actions, no steering,
no scheduling, no page.

## Goal

A daemon that survives its own death and the box's reboot, and that knows **what the fleet has been
doing over time** — which is the thing nothing on this box records today.

Greg, 2026-09-08, asked whether the Overseer is a daemon, a long-running session, or a daemon
supervising a session, and declined all three:

> I'm not certain what the right answer is. It may be that there's both a daemon and a long-running
> session, plus the web interface, and maybe some kind of store (probably gitignored, could be json
> or sqlite or something else, but start simple for now) so that we can resume easily if the session
> got killed (and ideally the overseer should be able to resume itself and all the running sessions
> if the box got rebooted).

## Why this is first, when Greg asked for attention triage first

He ordered the capabilities *attention triage, then box vitals and throttling, then account usage
limits, then scheduler*. Triage is still first — but **ranking by "who has needed me longest" needs a
duration, and a duration needs history.** The dashboard's own
[`tools/fleet/status.ts`](../../tools/fleet/status.ts) concedes the gap in `StatusedSession`:
`activityAt` is the session's *creation* time, with a comment saying it is a weak proxy and that
"the day a real clock exists this is the one field that changes". This stage is that clock. So the
store is not a detour before triage; it is triage's first half.

## What we already know, and must not re-derive

All measured on 2026-09-08 unless stated. The first is the finding that makes this stage necessary.

- **Nothing durably records what is running.** Session identity — `claudeId` and the four `META`
  fields `GJD_METADATA_VERSION` / `GJD_KIND` / `GJD_REPO` / `GJD_REMOTE_DIR` — is pinned into the
  **tmux environment** at launch ([`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts)),
  and a reboot takes the tmux server and all of it. `gjd-remote` writes only a log. Transcripts
  survive under `~/.claude/projects/`, but **which** sessions were alive, and what each was for, is
  written down nowhere.

### What resume actually needs, and what it can never get back

Spiked 2026-09-08. Two corrections to what this plan assumed, both of which make the register
*larger* rather than smaller — which is the direction you want to be wrong in only once.

**`gjd-remote` cannot resume anything.** `new-claude`
([`scripts/gjd-remote.ts:2484`](../../scripts/gjd-remote.ts)) always mints a fresh `randomUUID()` and
passes `--session-id <new-uuid>`; it never passes `--resume` or `--continue`. And `gjd-remote resume`
is a different feature entirely — `tmux attach -d`, which needs the tmux session to still be alive.
So O4 is not "call the existing tool"; the CLI has the machinery (`-r/--resume`, `-c/--continue`,
`--fork-session`) and our tooling uses none of it. **That is a change to `gjd-remote`, and it should
be a flag on `new-claude` rather than a second launcher in `tools/overseer/`.**

**The transcript path is not enough, and this plan previously said it was.** The directory in
`~/.claude/projects/` is a *slugified* cwd, so it is lossy; and `repo` is provably not derivable from
the directory at all — [`scripts/gjd-remote-log.ts`](../../scripts/gjd-remote-log.ts) says so in a
comment. So the register records the real values rather than reconstructing them:

| field | why, and whether it survives a reboot without us |
|---|---|
| `claudeSessionId` | what `--resume` takes. Recoverable from the transcript filename, but see identity below |
| `dir` | the real path. **Not** recoverable — the projects directory holds a lossy slug |
| `repo` | **Not derivable from `dir`.** Must be recorded |
| `kind`, `metadataVersion` | the `META` contract; tmux-only, so gone |
| `name` | the human handle, and the claim register other jobs rely on |
| `model`, `permissionMode` | not set by `gjd-remote` today and not reported by `claude agents --json`, so **if a future flag ever sets one, there is currently no way to recover it.** Record them the moment anything can vary them |
| `lastSeenAlive` | the heartbeat. Absent-and-finished and absent-and-killed look identical without it |

**What no register can restore**, and O4 must say so plainly rather than implying a fleet that comes
back whole: the in-flight turn and its tool calls, all subagent state under
`~/.claude/teams/session-<id>/`, and every pid-keyed socket identity
(`~/.claude/sessions/<pid>.json`, `/run/user/1000/cc-socks/<pid>.sock` — tmpfs, gone on reboot
regardless). A resumed session is the *conversation* back, not the *work* back.

**Resuming a session that never died is untested territory.** `--bg --resume` documents a guard
("starts a copy and says so when the session is already running"); plain interactive `--resume`
documents none, and nobody here has tried it. So the Overseer checks liveness before it ever calls
resume, and O4's dry-run exists partly to make that check visible.
- **The Overseer does not collect.** Settled with the dashboard agent on 2026-09-08. Its server
  serves the whole snapshot at `/api/state` and streams it at `/api/live` (SSE, event name
  `snapshot`, same bytes by construction — both call one `statePayload()`). A collection costs ~12s
  of transcript grepping, the dashboard already chains one every 60s from the *end* of the previous
  run with 5× backoff after a failure, and this box hit load 391 with the OOM killer firing that
  morning. **A second collector is a real cost, not untidiness.**
- **`/api/state` verified live**, returning `rows`, `collectedAt`, `tookMs`, `error` and `health`.
- **Box vitals are already built and are not ours.**
  [`tools/fleet/health.ts`](../../tools/fleet/health.ts) implements
  [diagnose-box-resources.md](../reusable/diagnose-box-resources.md), with every field a
  discriminated union that can say *I could not tell* rather than returning a zero that reads as
  healthy. Verified live: `strained — load average 40.8 is over 2x the 16 cores, actively swapping`.
- **The box is genuinely short of resources.** Load 33–41 against 16 cores, 23 of 30 GB of RAM and
  18–23 of 31 GB of swap in use, on an ordinary afternoon.

## Design decisions

### The store lives outside the repo

`~/.overseer/`, overridable with `OVERSEER_STORE_DIR`. **Not** in `data/` or `logs/` inside a
checkout, and this is the decision most likely to be got wrong by someone copying a nearby module.

Three reasons, and the first is a hazard we have already been bitten by. Every agent works in its own
worktree and **removes it when the job is done**; `data/` is gitignored, so a clean `git status` says
"safe to delete" over the top of it ([worktrees.md](../project/worktrees.md)) — a store in the tree
would be deleted by the next agent to finish, silently, with no copy anywhere. Second, the Overseer
is a **box-level** daemon spanning `spideryarn2`, `hellozenno` and bare shells; a per-checkout store
would be one store per worktree, which is not a store. Third,
[orchestrator-direction.md § Principles](../project/orchestrator-direction.md#principles) already
says this tooling "is not Spideryarn" and must not depend on the product.

### JSONL, and events rather than samples

Greg said "start simple", and named JSON or SQLite. **Append-only JSONL first.** It is crash-safe by
construction (a torn last line is detectable and discardable, and nothing earlier is at risk), it
adds nothing to `package.json`, and a human can `grep` it — which matters, because the first consumer
of this history is Greg wanting to know what happened overnight.

**What would force SQLite**, named now so the next reader does not re-open the choice: a read that
has to scan the whole history to answer a page load. Attention triage (O2) does not — it needs "when
did this session last change", which is a running fold the daemon keeps in memory and republishes.
If O6's scheduler wants "every run of job J in the last month", revisit.

**Events, not samples.** A row when something *changes*, not a snapshot every tick. Sampling 36
sessions every 60s is ~52k rows a day of overwhelmingly nothing, and the thing you want to read back
is the transitions. The heartbeat is the exception and it does **not** go in the append log — it goes
in `current.json`, which is overwritten.

Files are per-day, `events-YYYY-MM-DD.jsonl`, so the history can be pruned or archived by deleting
whole files and a day's worth can be read without touching the rest.

### A snapshot is only evidence if it is fresh and complete

**The failure this guards against: recording 36 `session-gone` events because the dashboard was
restarting.** The rules, all three of which must hold before a snapshot is diffed:

- **`error` must be null.** The dashboard keeps and serves its last good snapshot when a refresh
  fails, marking it stale — correct for a page, and inadmissible as evidence of change. **Verified in
  the code, not just its comment** ([`tools/fleet/server.ts`](../../tools/fleet/server.ts)): the
  catch sets `lastError` and leaves `snapshot` alone, and — the part that matters — it then calls
  `broadcast(statePayload())` anyway. **So a failed refresh is pushed down the SSE stream too.** A
  subscriber that treats every `snapshot` event as a fresh observation would record a stale one.
- **`collectedAt` must be non-null and must have advanced** since the last diffed snapshot. The same
  snapshot served twice is one observation, not two, and SSE plus polling guarantees we see it twice.
  **Non-null is not pedantry:** before the first collection completes, `statePayload()` substitutes
  `{ rows: [], collectedAt: null, tookMs: 0 }`, so a subscriber connecting to a just-started
  dashboard gets a real payload with a null clock. A naive comparison against a previous string
  would either throw or silently treat null as "not advanced" for the wrong reason.
- **`rows` must be non-empty.** An empty fleet is possible in principle and near-impossible here; the
  underlying parse refuses a short listing rather than returning one, so an empty list is far more
  likely to be a bug than a fact. It is also exactly what the startup payload above contains, which
  is the concrete case: **the first thing the Overseer sees on connecting to a restarting dashboard
  is an empty fleet**, and without this rule that reads as 36 sessions dying at once. Treat it as a
  source failure, and record *that*.

A snapshot that fails any of these produces a `source-degraded` event, not silence. **A dead
dashboard is a fact the Overseer records, not a silence it sits in** — the coupling created by
consuming someone else's stream is only acceptable if its failure is visible.

### Identity is the tmux handle AND the Claude session id, never the handle alone

The obvious key is the tmux handle (`$1643`) — it is immutable, it survives renames, and
`gjd-remote` addresses everything by it for good reasons. **For a live view that is right; for a
history it is wrong.**

A tmux session can be resumed into a *different conversation*: same handle, same name, same pane, new
Claude session id. Keying a timeline on the handle alone would silently splice two conversations
together and present them as one agent working continuously — the worst kind of wrong, because the
result is plausible and nothing about it looks broken. Handed to us by the dashboard agent on
2026-09-08, along with the fields to fix it: `FleetRow` now carries `claudeSessionId` and `panePid`
beside `paneId`, from the same `list-panes -a` call.

So the store's identity is the **pair**, and a handle whose `claudeSessionId` changes is a
`session-replaced` event — neither a death nor a birth, and distinct from both. That is the third
case in a distinction this plan previously had only two of:

- the tmux session was killed → `session-gone`
- its Claude exited, tmux still there → a status change, not a disappearance
- the handle was reused by a new conversation → `session-replaced`

**All three look identical if you key on the handle**, which is exactly why the plan review was asked
whether `session-gone` was the right concept.

### Two clocks in `current.json`, never one

`writtenAt` (the Overseer last wrote) and `lastGoodSnapshotAt` (it last successfully heard from the
dashboard), plus `schemaVersion`. Requested by the dashboard agent so its page can say "the Overseer
last spoke 9 minutes ago"; made a pair because **they come apart exactly when something is wrong.**
One number cannot distinguish "the Overseer is dead" from "the Overseer is alive but deaf", and those
need different responses. Written atomically (temp file + `rename`) so a reader never sees half a
file.

### Status equality is by structure, never by prose

This is the change that has to land in shared code, and it is the dashboard agent's GPT Sol finding
**F6**, which they offered us because it bites us harder than them
(they will stay off `status.ts` until we say it has landed).

`SessionState`'s `unknown` arm is `{ kind: "unknown"; why: string }`, and the three construction
sites in [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) are told apart only by
their sentences. `statusOf` in `tools/fleet/status.ts` then *composes* a fourth: it appends the box's
own error text (`claude: command not found`) to the reason.

For a page that is fine. For a store it is a defect: **we compare consecutive statuses to decide
whether anything changed**, so a reworded sentence — or an error string that varies between calls —
would read as a state transition, and the history would show sessions flapping when nothing happened.

The fix: add a `cause` to the arm, a string-literal union (`"not-a-session-id"`,
`"agents-unavailable"`, `"unrecognised-status"`), keeping `why` for display. Equality in the store is
then `kind` plus `cause`, and never `why`.

It also makes `statusOf`'s existing comment true. It says it distinguishes the two unknowns by asking
`sessionState` again with an empty map so as to read "the source's structure rather than its prose" —
and then compares `asIfAnswered.why === state.why`, which is prose. With a `cause` that comparison
becomes structural, which is what it was already trying to be. Precedent for the shape is in the same
directory: `steer.ts`'s `Refusal` is exactly `{ code, why }`.

### Fallbacks, and the one that must stay slow

Source preference: **SSE** (`/api/live`) → **poll** (`/api/state`) → **own `collect()`**. The last is
the only one that costs the box anything, so it runs at a deliberately slow interval (default 10
minutes, `OVERSEER_FALLBACK_MS`) and only when the dashboard is unreachable. A fallback that grazes
every 12 seconds on a swapping box is worse than a gap in the history, and the gap is recorded
either way.

## Stages

Four, each ending committable and green. O1a and O1b touch disjoint files and run in parallel.

### O1a — the event log, the diff, and the `cause` fix

Pure functions and types. No network, no daemon, no timers.

- `tools/overseer/events.ts` — the event union (`session-seen`, `session-status`, `session-gone`,
  `health-change`, `source-degraded`), each with `at`, a `schemaVersion`, and enough identity to
  rebuild the register.
- `tools/overseer/diff.ts` — `diff(previous, next) → Event[]`, with the three admissibility rules
  above as an explicit `admissible(snapshot)` predicate returning a reason when it refuses.
- `tools/overseer/store.ts` — append (per-day file, `O_APPEND`), and `read(day)` that **discards a
  torn final line rather than throwing**, because a crash mid-write must not make the history
  unreadable.
- The `cause` fix in `scripts/gjd-remote-tmux.ts` and `tools/fleet/status.ts`, plus the
  `asIfAnswered` comparison switched to structural.
- **Done:** given two captured snapshots, the right events come out; an inadmissible snapshot
  produces `source-degraded` and no `session-gone`; a torn line round-trips; a status whose `why`
  changed but whose `kind` and `cause` did not produces **no** event.

### O1b — the source

- `tools/overseer/source.ts` — SSE subscription with poll fallback with `collect()` fallback, each
  transition recorded. `node:http` only; nothing new in `package.json`.
- **Done:** against a fake local server, each fallback is exercised and each is observable; a server
  that returns a stale (`error` non-null) payload does not advance the clock.

### O1c — the daemon and `current.json`

- `tools/overseer/daemon.ts` — wire O1a to O1b, keep the running fold, write `current.json`
  atomically, maintain both clocks.
- **Done:** run it against the live dashboard for a few minutes and show the event log and
  `current.json` — real output, not a test's.

### O1d — restart and reboot

- systemd user unit, `Restart=always`, via `infra/hetzner/provision.sh` — a change to the box is a
  change to the file that builds the next one
  ([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md)).
- On start, read back today's events and rebuild the fold, so a restart continues rather than
  begins.
- **Done:** `kill -9` the daemon; it comes back and the history is continuous across the gap, with
  the gap itself visible.

**Reboot-resume of the sessions themselves is O4, not here.** This stage only makes it *possible* by
recording the register.

## What this stage is not

No steering, no scheduling, no killing, no page, no usage-limit reading, and no second collector.
Autonomy for the whole Overseer is currently *may dispatch scheduled jobs and nothing else*
(Greg, 2026-09-08), and this stage does not even do that.

## The simpler options passed over

- **Do nothing; let the dashboard grow a store.** Rejected by both agents: the dashboard is
  deliberately stateless, its author has no plans to persist anything, and a page process that also
  owns durable history has to be restarted to change either.
- **Sample every tick instead of diffing.** Simpler code, and it is what a first draft wants to do.
  Rejected on volume (~52k rows/day of nothing) and on readability — the transitions are the thing
  you want to read, and burying them in samples means writing a query to find them.
- **Put the store in `data/`.** Rejected: worktree deletion, per-checkout fragmentation, and the
  not-Spideryarn principle. See above.
- **SQLite now.** Rejected as premature; the condition that would change it is named above.
