# The Overseer's store, and the clock it gives everything else

**Status 2026-09-08, 09:35: the Overseer runs, and has never yet run where it will live.** S1, S2,
S3, S4 and S6 are landed, reviewed and green; S5 (the systemd units) is being built now; S3-03 and
two smaller findings are stage S7, in flight. Evidence: `npm run typecheck` reports **0** failures
across all four projects, **245 tests pass** across the eight Overseer files, and `tools/overseer/`
plus `scripts/overseer.ts` is 5,830 lines.

**The live run, quoted here because its store was a scratch directory that will be deleted with the
session.** Against the real dashboard on `:8787`, 2026-09-08 07:30–07:52 UTC, store root
`scratchpad/overseer-live`: **43 events in 22 minutes — 30 `session-seen`, 8 `session-status`, 5
`tmux-session-gone`** — and three of those five name the daemon's own earlier incarnations
(`overseer-live-…`, `overseer-degrade-…`, `overseer-restart-…`), each with `why:
"absent-from-snapshot"`. Its `daemon.jsonl` holds 3 `daemon-started` and 2 `daemon-stopped`, so one
run ended without writing a stopping note, which is the `kill -9` the recovery test used.

**And the thing that number does not say, found by checking rather than by remembering:
`~/.overseer` does not exist.** `overseer status` against the default root reports *"NEVER RUN — no
checkpoint and no notes"*. Every run so far has been against a scratch root, which was right for a
test and means the production store is empty and unproven. **Naming the root is part of the claim** —
"the daemon has been run" and "the daemon has been run where it will live" are different sentences,
and only the first was ever true. Closing that is S5's acceptance, not a separate task: the unit sets
`OVERSEER_STORE_DIR=/home/greg/.overseer` explicitly, and the evidence it must produce is events in
*that* file.

**Both P0s are closed**, one in the differ and one in the store's lock, each after a review round that
found the first fix insufficient. Every Sol finding is either fixed or refused with reasons in this
file.

**What is NOT done, and is not an agent's to do:** the reboot criterion in § S5. Nobody has rebooted
the box, and nobody should — it carries ~27 live agent sessions and ~15 worktrees of other people's
uncommitted work. See § S5 for what is proven instead, and why that evidence is the thing Sol's F7
was actually about.

Greg, 2026-09-08, on the remaining work: *"Reprioritise as you see fit, work in parallel where you
can."* What that changed is in § The order, reconsidered.

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
## Revised after review — what changed and why

**GPT Sol reviewed this plan on 2026-09-08 and its verdict was "do not build this plan as written":
four P0s, and the architecture sound underneath them.** The review is
[260908b-plan-review-sol.md](260908b-plan-review-sol.md). Everything below is the plan after those
findings. Three of the findings were checked against the tree by hand before being accepted, and one
turned out to be partly answered already — noted where it is used.

The single most important consequence: **this stage now depends on a contract change the dashboard
agent owns.** See § The observation contract.

### JSONL, and events rather than samples

Greg said "start simple", and named JSON or SQLite. **Append-only JSONL first**, in ONE file — not
one per day. It adds nothing to `package.json`, and a human can `grep` it, which matters because the
first consumer of this history is Greg wanting to know what happened overnight.

**Daily rotation was in the first draft and is removed (Sol F2, P0).** The fold cannot be rebuilt
from today's file alone: a session seen at 23:58 with a daemon restart at 00:01 finds an empty file,
starts with an empty fold, and emits a *second* `session-seen` for a session that never went
anywhere. A daemon down across midnight does the same, and pruning an old file could delete the only
event establishing a still-live session. Rotation needs a checkpoint to be safe, so the checkpoint
comes first and rotation waits.

**`current.json` is therefore a real checkpoint**, not just a status page: it carries the complete
register, the last accepted observation's identity, and the event cursor. A restart replays events
after that cursor rather than replaying a day.

**What would force SQLite**, named so the next reader does not re-open it — and broader than the
first draft's single condition, per Sol: indexed historical queries, transactional multi-record
state, concurrent writers, or retention and compaction becoming awkward. **Refusing concurrent
writers is preferable to adopting SQLite in order to tolerate them.**

**Events, not samples.** A row when something changes, not a snapshot every tick.

### Appending safely, which is not the same as appending atomically

`O_APPEND` makes a write land at the end. It does **not** make the file well-formed, and the first
draft's "discard a torn final line on read" is not a repair (Sol F3, P0):

> a crash leaves `{"kind":"session-` with no newline, restart ignores that suffix, the next append
> writes a valid object immediately after it — the valid event is now concatenated onto corrupt
> bytes, and after another append the malformed record is no longer the final line, so reads either
> fail or lose the first post-restart event.

So: **truncate to the last complete newline before reopening for append**, under the store lock. The
test is the whole sequence — torn write, restart, append, append, read — not just "a torn line is
skipped", because that test passes against the broken design.

### One daemon, enforced

`O_APPEND` protects the write position and nothing else (Sol F4, P0). Two daemons — after a botched
restart, or one started by hand in a worktree while systemd runs another — would both append the same
transitions and both overwrite the checkpoint, leaving duplicated history and whichever checkpoint
renamed last.

**A store-wide exclusive lock, acquired before reading any state and held for the process lifetime,
and a loud refusal to start second.** The lock lives in the launcher so systemd and a manual start
obey the same rule. `pid` and a random `instanceId` go in `current.json` for diagnosis, but they are
not the lock.

### The observation contract, and why this stage depends on another agent

**`FleetRow` does not carry what reboot recovery needs** (Sol F1, P0 — and the part of it about
`claudeSessionId` was already fixed by the dashboard agent before the review was written).
`Session` has `meta.dir` and `meta.kind`; `collect.ts` uses `meta.dir` only to derive the worktree's
*name* and drops the rest. Combined with the spike above — the projects directory is a lossy slug,
and `repo` is not derivable from the directory — a reboot would leave a tmux handle and some display
fields, and no way to say which conversation to resume or where.

So the dashboard's payload needs `dir`, `kind` and the metadata version, plus a **schema version**,
and ideally a **boot/source generation** so that "the same tmux handle in a new tmux server" is
distinguishable from "the same session". Requested; the shape is the dashboard agent's call.

**Parse it strictly.** From `unknown`, failing the *whole* snapshot on any malformed row, duplicate
identity, invalid timestamp or unknown schema — never filtering bad rows and diffing the remainder,
which would manufacture `session-gone` for the rows that were dropped.

### A snapshot is only evidence if it is fresh — and "duplicate" is not "degraded"

Two rules, not three. The first draft's third rule is **removed** (Sol F5, P1): `rows.length > 0`
does not mean complete. A regressed response with 35 of 36 rows is non-empty and would emit a false
`session-gone`, while a genuinely empty fleet is valid evidence that strict parsing should accept.
The startup placeholder it was really guarding against is caught by the clock rule instead.

- **`error` must be null.** Verified in the code rather than its comment
  ([`tools/fleet/server.ts`](../../tools/fleet/server.ts)): the catch sets `lastError`, leaves
  `snapshot` alone, and then calls `broadcast(statePayload())` anyway — **so a failed refresh is
  pushed down the SSE stream too.**
- **`collectedAt` must be non-null and must have advanced.** Non-null is not pedantry: before the
  first collection `statePayload()` substitutes `{ rows: [], collectedAt: null }`, so a subscriber
  connecting to a just-restarted dashboard receives an empty fleet with a null clock. At this
  revision, an advanced `collectedAt` really does mean a collection ran — `collect()` stamps it only
  after collecting, and `statePayload()` reserialises the cached object unchanged. **That is a
  contract we depend on and do not own, so it gets a test**, until the producer offers a sequence
  number instead.

**And a repeated `collectedAt` is a normal duplicate, not a degradation** (Sol F6, P1). SSE sends its
cached snapshot on reconnect, and polling runs between refreshes; with both active this is constant.
The first draft would have emitted `source-degraded` continuously against two healthy processes. So
an observation resolves to a three-armed result:

```
accept | duplicate | reject
```

`duplicate` is a no-op. `reject`, or a freshness deadline expiring, moves the source to degraded
**once** — and there is a matching restoration event, which the first draft lacked entirely, so
degradation could be recorded and recovery could not.

**A freshness watchdog is required**, because an SSE connection can stay healthy while no new
snapshot arrives behind it — the collector wedged rather than the transport broken. `writtenAt` is
the daemon's heartbeat; `lastGoodSnapshotAt` is the *producer's* `collectedAt` from the last accepted
observation, not when an HTTP response arrived.

### What counts as a change: a canonical key, never deep equality

Sol F10, and the finding that would have quietly made the event log useless. **`waiting.secondsLeft`
changes on every collection**, so a structural comparison emits a `session-status` event every minute
for every waiting session, all of them saying nothing. `HealthReport` is worse: it carries
`collectedAt` and `tookMs`, so *every* tick is a health change.

**Measured, not reasoned.** 24 polls of the live dashboard over 12 minutes on 2026-09-08 gave 11
distinct collections and, summed over every session present in both halves of each transition:

| comparison | count |
|---|---|
| **any field differed** | **72** |
| **kind, `shell.busy` or the unknown cause differed** | **2** |

**A 36:1 ratio of noise to signal**, almost all of it `waiting.secondsLeft` counting down and
`health`'s own `collectedAt` / `tookMs` / load numbers. So a naive comparison would have written
seventy-two events, seventy of which say nothing, and buried the two that matter.

So each status has a **canonical transition key** — `kind`, plus `shell.busy`, plus `unknown.cause`
— and countdowns and prose are deliberately excluded. Volatile detail belongs in `current.json`,
which is overwritten, not in an append-only log.

**Health history is deferred out of O1 entirely.** With the verdict-versus-cadence question unsettled
and this stage existing to unblock attention triage, recording health is the part that can wait.

### No local `collect()` fallback in O1

Removed (Sol F9, P1), and the reason is better than the rule: **`FleetSnapshot` has no `health`
field** — health is added by the *server*, not by `collect()`. Verified. So the fallback would have
returned a different contract, and a missing health block would have read as a health *change*,
manufacturing history from a fallback. It also does not honestly reduce load: a ten-minute interval
lowers the average but does nothing to stop the two expensive collections overlapping at the worst
moment.

**So the source gap is recorded and nothing is collected.** "One collector" becomes true rather than
aspirational.

### Identity, and the three ways a session can stop being there

**CORRECTED 2026-09-08, late: `claudeSessionId` is a claim that decays, not an identity.** Measured
on the live box by the agent who owns the producer, and it undercuts what the rest of this section
originally said. Two facts:

- **It is set before Claude runs.** `CLAUDE_SESSION_ID` is written into the tmux environment at
  `tmux new-session -e …`, so a `--wait 6h` session carries a conversation uuid for six hours while
  its pane runs `sleep 21600`. On the live payload, **30 of 35 rows carried a uuid and 5 of those
  were `waiting`**, with no Claude process to match. **A uuid on a row is not evidence a conversation
  exists.**
- **It outlives the conversation.** The environment is written once and never updated, so if a pane's
  Claude exits and a fresh one starts, the row still names the *first* conversation.

> the uuid identifies a conversation, and the tmux environment's claim about which conversation is in
> a pane is a hint that decays.
>
> — the dashboard agent, 2026-09-08

**So the asymmetry is the finding, and it is what goes in the comment: a uuid that changes is real
evidence of replacement; a uuid that does not change is no evidence at all.** The `session-replaced`
event therefore fires correctly when it fires and **cannot be trusted by its absence** — which is
exactly the case it was invented for, so the event is weaker than this plan first claimed.

This is worse than an ordinary stale field, for the reason everything on this page is worse: a reader
keyed on a stale uuid does not fail. **It returns real, well-formed, correctly-attributed content
from a conversation that is not on screen** — the most convincing wrong answer available.

The only thing that resolves it is liveness evidence the pair cannot supply: a transcript's
`lastModified`. **A transcript last written hours ago on a row we call `working` is this bug**, and
it is the only available signal. That is filesystem I/O, so it belongs in S4 or later, not in S2's
pure logic; S2's job is to make the uncertainty impossible to overlook rather than to resolve it.

Two related hints, recorded so nobody re-derives them: **`meta.dir` does not locate the transcript**
— a path built from it finds the file for 7 of 30 sessions, because `EnterWorktree` *moves* the
transcript to the worktree's slug while `meta.dir` still names the primary, so the rule is try the
slug then scan. And **reading a transcript tail is affordable after all**: twelve turns cost 262 KB
of a 33 MB file in 4.5 ms, and all 35 rows come to 318 ms — which reverses the assumption that
conversation content was too expensive to keep.

**Identity is the pair (tmux handle, `claudeSessionId`), never the handle alone.** The handle is
immutable and is the right address for a live view, which is why `gjd-remote` uses it. For a
*history* it is wrong: a tmux session can be resumed into a different conversation — same handle,
same name, same pane, new Claude session id — and keying a timeline on the handle splices two
conversations into one. That is worse than an ordinary bug because the result is *plausible*: one
agent apparently working continuously, with nothing about it looking broken. Handed to us by the
dashboard agent on 2026-09-08, along with the fields that fix it.

Both reviewers reached this independently, from different directions: the dashboard agent from
resumption, Sol from tmux handles being reusable after the tmux server restarts. Two independent
derivations is the strongest evidence available.

So there are **four** ways a session stops being what it was, and all four look identical if you key
on the handle:

- the tmux session was killed → `tmux-session-gone`
- its Claude exited, tmux still there → a **status change**, not a disappearance
- same handle, same tmux generation, different `claudeSessionId` → `session-replaced`
- same handle, **different tmux generation** → *a different world*

`tmux-session-gone` is Sol's renaming of the first draft's `session-gone`, and it earns the extra
word: Claude exiting does *not* remove the row — it becomes `no-claude` — so only the tmux session
going removes it.

**The fourth case is the dashboard agent's, added 2026-09-08, and it is not a variant of the third —
it is a rule about when not to diff at all.** They landed `snapshot.tmuxServerPid` as a generation
(free: `#{pid}` on the `list-panes -a` they already run), which separates the two changes cleanly:

> a **reboot** changes the generation and nothing else; a **resume** changes the uuid and nothing
> else … Same handle + *different generation* is not a replacement at all — it's a different world,
> and the right move is probably to close every open session from the old generation rather than
> diff across the boundary. Diffing across it will generate a plausible-looking burst of
> replacements that never happened.

So the diff **refuses to run across a generation boundary**: it closes out the old generation's
register and starts the new one. That is the same failure class as everything else on this page — the
wrong answer is not an error, it is a plausible history — and it is the case a reboot produces, which
is precisely the event this whole stage exists to survive.

### What the payload now carries

Landed by the dashboard agent on 2026-09-08 (`bad6eee5`) in answer to Sol F1, and it is more than was
asked for:

- **`row.meta` is the whole discriminated union**, not flattened. Offered the choice, they took the
  union so that `meta.version === 1` gates `dir`, `kind` and `repo` together, rather than a
  `dir: string | null` that lets a consumer read the field without deciding what a legacy session
  means. `repo` and `worktree` stay on the row separately, lossy on purpose, for rendering.
- **`snapshot.tmuxServerPid`** — the generation above.
- **`schema: 1`**, with the bump rule written beside it: bump when a consumer that ignored the change
  would be *wrong*, not merely poorer. Adding a field is not a bump, because a version that changes
  on every addition is one nobody checks.
- **`refreshMs`**, which the freshness watchdog can use rather than hard-coding a deadline.

**And one correction to this plan's reading, in our favour:** SSE never emits the empty placeholder.
`subscribe()` passes `snapshot ? statePayload() : null`, so a subscriber connecting before the first
collection gets no initial event at all — it is the *poll* that can return `{rows: [], collectedAt:
null}`. The admissibility rules cover both, so nothing changes; but do not rely on "SSE always gives
me a payload". They have also extracted `statePayload` into `tools/fleet/state.ts` with a test
pinning that a null `collectedAt` is never replaced by a fresh timestamp for a caller's convenience —
which would be, in their phrase, a lie with a clock on it.

### What 12 minutes of the real fleet actually looks like

Captured 2026-09-08, and several of these contradict what a hand-written fixture would have assumed:

- **Churn is constant.** Every one of the 10 transitions had a session appear or disappear. There was
  **no fully steady pair in 12 minutes.** So `tmux-session-gone` is an ordinary event, not an alarm,
  and anything that reacts to one had better expect several an hour.
- **Collection is ~70s, not 60s** — chained from the end of a 5.7–11.0s run.
- **`repo` is not one value** — the claim stands, and **one of its four values does not, corrected
  2026-09-08 after two independent re-measurements.** As originally captured from a single 39-row
  snapshot: 35 `spideryarn/reading2`, one `null`, two the literal string `"unknown"`, and one
  `spideryarn/hellozenno`.

  **`null` and the second repo are real, and now have a mechanism rather than a count.** Across the
  ten fixtures in `tests/fixtures/overseer-snapshots/` the values are 58 `spideryarn/reading2` and 2
  `null` — and **both null rows carry `meta: {"version": "legacy"}`**, which is exactly what
  `collect.ts` produces (`repo: s.meta.version === 1 ? s.meta.repo : null`) for a session launched
  without the `GJD_*` environment variables. Two repos in one snapshot is not a defect either: it is
  two sessions in two checkouts. So *any logic assuming a single repo is wrong* survives intact.

  **The literal `"unknown"` does not reproduce and should not be designed against.** It appears in
  none of the ten fixtures, in **none of 551 same-identity row observations** over 25 live collections
  spanning 24 minutes, and — checked from the source by the fleet dashboard agent — in **neither the
  server's nor the client's `SessionMeta` type**. There is no code path known to emit it. The likeliest
  explanation is a mis-transcription when the original snapshot was read by eye.

  **Recorded as a correction rather than deleted**, because the wrong half is the instructive half: an
  unreproduced literal sitting in a list of captured measurements is precisely the thing a later agent
  writes a parser branch for, and a branch built for a value nothing emits is untestable, permanent
  and invisible. If it ever *is* seen again, it is a real finding in the collector and wants a
  snapshot saved, not a tolerance added.

  **And the way the re-measurement got it wrong is worth more than the correction.** The live sample
  reported *"no `null` in 551 observations"* and that was read as refuting the claim. It does not,
  because **every live row in that window was a version-1 session — the sample contained no legacy
  session at all**, so the measurement never had the chance to see the value it was said to rule out.
  The agent's own statement of the rule:

  > A census over a sample cannot refute a claim about which values are **possible**; only the source
  > can do that. The data that would have caught me was on disk the whole time — I asked it the
  > change-count question rather than the value-census one.

  **This is exactly the positive-control rule** written into
  [silent-success.md](../reusable/silent-success.md) earlier the same evening, arriving from a
  direction nobody expected: not a broken instrument reporting zero, but a working instrument reporting
  zero over a population that could not have contained the thing. The distinction the rule needs, and
  which this instance supplies, is between **measuring a frequency** and **refuting an existence** —
  a sample can do the first and never the second. Worth considering as an addition to that note if it
  recurs; one instance is an observation.
- **`title` is null for most sessions** (14 of ~37 had one), so null is the common case, not the edge.
- **`question` was null in every row of every snapshot**, and `shell.busy` was always `true`. Both
  branches are therefore **unexercised by real data** — worth knowing before trusting a test that
  only uses this capture.
- **`health.verdict.level` never moved off `strained`** for 12 minutes, while its `reasons` array
  changed almost every collection. A test for a verdict *transition* needs data from elsewhere.
- **Two different `tookMs` fields exist** — the snapshot's (whole collection) and `health.tookMs`
  (the health probe alone, 1.2–1.8s). Easy to confuse.

**And a lesson about the fixtures themselves.** That capture was taken at 02:15 and was **already the
wrong shape by 03:40** — the dashboard landed `meta`, `claudeSessionId`, `panePid`, `schema`,
`tmuxServerPid` and `refreshMs` in between, so the saved rows would have failed the strict parser
S2 is built around. The measurements above survive, because status objects did not change; the
fixtures did not.

So: **capture fixtures against a producer that is still moving, and re-capture them at the moment you
write the parser, not before.** Committing that first set would have been worse than having none —
a test passing against a shape the producer no longer emits is a test that has stopped watching.

## Stages

**Re-sliced per Sol F11**, which observed that the first draft's stopping points were not honest: its
"pure functions" stage did filesystem I/O and bundled a shared-API migration with new domain code,
and its "restart and reboot" stage only tested `kill -9`.

### S1 — the `SessionState.cause` migration, alone

Nothing else. A shared-API change with every consumer and test green is a stage.

- **Five construction sites, not three** (Sol F8; counted by hand — the plan said three and was
  wrong). The two missed: *"its Claude is running, but Claude Code did not list it"* and *"the box
  could not look at what is running in it"*.
- `collect.ts` builds its own fallback unknown. That join failure is impossible rather than ordinary,
  so it should **throw** rather than become a sixth cause.
- Once `cause` exists, `statusOf` can enrich only `cause === "agents-unavailable"` and its second
  `sessionState(..., LISTED_NOTHING)` call goes. That deletes the cleverest part of the dashboard's
  file, so it is the dashboard agent's call, not ours.
- The browser's separate wire union currently discards `cause`; whether it preserves it is likewise
  theirs.
- **Done:** `npm test` and `npm run typecheck` green, `gjd-remote ls` still renders, and a mutation
  proves a test notices.

**✅ LANDED 2026-09-08.** Seven causes, not the six planned — `not-a-session-id`,
`agents-unavailable`, `unrecognised-agent-status`, `running-but-unlisted`,
`process-probe-unavailable`, `no-status-derived`, and `client-declared`. Five construction sites in
`sessionState` confirmed by hand; the plan's original "three" was wrong.

Three things learned in the doing, all worth more than the change itself:

- **A cause must not carry anything that varies for reasons the consumer does not care about.**
  `unrecognised-agent-status` deliberately does *not* include the status name it found: a box
  reporting two unfamiliar statuses in turn has one problem, and folding the name in would
  reintroduce exactly the flapping the field exists to stop. The dashboard agent generalised it into
  the rule worth keeping — **prose, counters, countdowns and timestamps belong beside a diff key,
  never in it.** It is `waiting.secondsLeft` again, one level up.
- **The seventh cause came from a disagreement worth losing.** `routes-steer.ts` parses a status a
  *client* declared, and stamping one of the six box-faults on it would launder a browser's assertion
  into a field whose whole purpose is to say what the box observed — *"the same class of error as
  inventing a `collectedAt` for a collection that never happened"*. Hence `client-declared`, named for
  the fault in the same sense as the others, because **the fault is the absence of an observation.**
  Rejecting the body instead was the other option and is worse: it replaces an informative
  `declared-not-steerable` refusal with "your JSON was wrong", and the refusal sentence is the
  product.
- **The exhaustiveness guard fired for real, and only under `typecheck`.** The test annotates its
  fixture as an exhaustive `Record` over the causes, so adding `client-declared` broke compilation
  until it was accounted for. **`npm test` cannot catch it** — vitest does not typecheck — so a
  type-level guard here is only ever as good as the `typecheck` gate.

`statusOf`'s second `sessionState(…, LISTED_NOTHING)` call and the constant are gone, with the
reasoning kept in the comment and a line saying the trick is no longer how the distinction is drawn.
Evidence: 220 tests across the four affected files; three mutations, all caught, one at compile time.
The one remaining `typecheck` error is `routes-steer.ts`, handed to its owner deliberately rather
than swept into a pathspec commit over their uncommitted work.

### S1's review, and the one finding it handed to S2

GPT Sol reviewed the landed stage: **one P2 and nothing else**, with all three of the suspicions
listed in the review prompt disproved —
[260908b-s1-code-review-sol.md](260908b-s1-code-review-sol.md). It proved the `statusOf` equivalence
from the clause ordering rather than accepting the claim (an invalid id and a wait both return before
`agents` is inspected, so every session reaching the `agents === null` clause necessarily produces
`agents-unavailable`); confirmed the `Exclude` is a real guard, since adding a union member without
touching the fixture is a type error and *no* test can stop somebody deliberately editing its own
assertion; and confirmed nothing load-bearing died with `LISTED_NOTHING`.

**S1-1 (P2) is a real tension and it belongs here rather than there.** `unrecognised-agent-status`
deliberately drops the status name it found. Sol's objection:

> a future Claude version reports `compacting`, then `waiting-for-input`; both collections produce
> the same transition key … the intermediate status is permanently lost despite the source having
> changed. Unlike reworded prose, the reported status token is machine-readable observed data and may
> encode a real transition.

That is not the same thing as the rule it appears to contradict. *A field a consumer will diff must
not contain anything that varies for reasons the consumer does not care about* was aimed at **our
wording**; the status token is **the box's observation**, and it changes only when the box says
something different. The two arguments were about different objects — "we have one diagnostic
problem" versus "the session moved" — and both are right about theirs.

The resolution is not to reopen `cause`, which should stay stable, but to carry the token separately
and decide whether it participates in the canonical key. **That is an S2 decision by construction,
because S2 is where the canonical key is defined**, and Sol agrees it need not block S1. Recorded so
it cannot be lost between stages: the near-certain trigger is an ordinary Claude Code upgrade
introducing a status this version has no arm for, which will happen every few months rather than
never.

### S2 — the observation contract and the pure logic

Types and pure functions. No I/O.

- The versioned observation DTO agreed with the dashboard agent, parsed strictly from `unknown`.
- `admissible()` returning `accept | duplicate | reject` with a reason.
- `diff()` over canonical transition keys.
- **Done:** against the captured real snapshots, the right events come out; a duplicate produces
  nothing; a 35-of-36 payload is rejected whole rather than diffed.

**✅ LANDED 2026-09-08.** `tools/overseer/` — `observation.ts`, `admissible.ts`, `diff.ts`, 1014
lines. **Every import in all three is `import type`**, so the directory has no runtime dependency at
all, does no I/O, and nothing at module scope does anything. 168 tests; typecheck green on all four
projects. Six mutations, all caught.

Three things it decided or discovered that are worth more than the code:

- **The fixtures cannot catch the bug they were captured for, and this is now in their README.**
  The 51-versus-2 noise ratio was summed over the *untrimmed* capture; the eight committed files hold
  only `idle`, `working`, `needs-you` and `shell`, **none of which has a volatile field**. So a differ
  comparing whole status objects structurally passes every real pair, and the mutation that proves the
  canonical key matters was caught only by a *constructed* countdown case. A good correction to this
  plan's brief, which had asserted the opposite.
- **A clock that goes backwards is `reject`, not `duplicate`.** The brief said duplicate when
  `collectedAt` "has not advanced", which covers equal and earlier alike. Equal has an innocent
  explanation every minute; earlier has none — a second producer, an NTP step, a cached body served
  after a fresher one. Calling it a duplicate stalls the history silently for as long as the skew
  lasts; rejecting is visible and self-clearing.
- **The producer moved mid-build and the typecheck caught it within the hour.** `fleetState()` grew a
  fifth parameter, `answeringEnabled`, correctly without a schema bump per the producer's own rule.
  Nothing else changed, because the parser ignores unknown fields — but it is the drift the fixtures
  README warns about, happening live, between two agents.

The `claudeSessionId` correction arrived mid-build and cost about forty minutes: `ObservedRow`
carries `claimedConversationId`, a **branded** string so that using it as an identity requires a cast
and the cast is where the reader meets the doc comment. `sessionKey` encodes the pair as
`$1991 claims:<uuid>` — **the word `claims` is in the key** so that a human grepping the log does not
read that half as verified either. The asymmetry is documented on the event under the heading
*"`session-replaced` FIRING IS EVIDENCE; ITS SILENCE IS NOT"*, and there is a test named
**"KNOWN BLIND SPOT: a replacement the tmux environment did not notice produces nothing"** that
asserts the empty result, so the limitation is pinned where someone will read it rather than left in
prose.

### S2's review: a P0, five P1s, and the suite passed through all of them

[260908b-s2-code-review-sol.md](260908b-s2-code-review-sol.md). **Not fixed — S2 is landed but not
finished**, and this section is what the next session picks up.

**S2-01 (P0) — an unreadable generation silently bridges two tmux worlds.** Exactly the suspicion the
review prompt named, which is the useful outcome of naming it. Generation `100` → `null` → `200` is
two `unverifiable` steps, both diffed normally, so a reboot in the middle produces either silence or
a status transition attributed *across unrelated sessions* that happen to share a reused handle.
**A non-empty snapshot with a null generation must not advance the baseline**; an empty one may,
because there are no handles to equate. The existing test pins the unsafe default, so the fix must
change a test that currently passes.

The five P1s, each the same shape — a value the producer would never emit, accepted here and turned
into a fabricated event:

- **S2-02** `tmuxServerPid: 132280.5` parses because it is finite, and a fractional pid reads as a
  generation *change*. Same weak domain check on `panePid`, `secondsLeft`, `tookMs` and `refreshMs` —
  and a zero or negative `refreshMs` would later poison the freshness watchdog S4 depends on.
- **S2-03** a wait that is *restarted* is invisible: `secondsLeft: 60` then `3600` is one key, so the
  history shows one uninterrupted wait. Suppressing a countdown is right; suppressing a material
  increase is not, and the fix is comparison logic (an implied deadline with tolerance) rather than
  key material.
- **S2-04** `reportedStatus` is accepted on causes the producer says can never carry it, so two
  malformed rows manufacture a status transition. Wants a local discriminated union making the
  combination unrepresentable *after* parsing.
- **S2-05** equal clocks are trusted as identical collections without checking the bodies agree. Two
  payloads claiming one timestamp with different generations is contract failure, not a duplicate,
  and it currently disappears silently.
- **S2-06** the register fields kept *for reboot recovery* are validated more weakly here than at the
  producer: a relative `meta.dir` parses, and a later resumer would resume a real conversation in
  whatever directory the daemon happened to occupy.

**And the verdict that matters more than any single finding:**

> A parser that accepts impossible numeric domains, an admissibility gate that trusts inconsistent
> equal-clock payloads, and a differ that loses wait resets **all pass the suite**.

168 tests, six mutations caught, and three real defect classes walked through untouched. The mutations
proved the code does what it was written to do; they could not show what it was never written to
handle. **That is the lesson of this stage** and it belongs beside the fixtures README's own
admission: mutation testing proves a test notices *your* change, not that the design is right.

Two judgments to keep: `SessionKey` and `StatusKey` earn their brands; **`ClaimedConversationId` does
not** — it validates nothing and risks implying verification it does not perform. Sol would spend that
brand instead on an opaque admissible-snapshot type (S2-07), so that `diff()` cannot be handed a
snapshot `admissible()` never blessed — which is currently only a comment.

### What landed, and the three things the work turned up

**S2's eight findings are all addressed**, red-first, with 69 tests where there were 40.
[260908b-s2fix-review-prompt.md](260908b-s2fix-review-prompt.md) is the narrowly-scoped check of the
fixes, per [engineering-manager.md](../reusable/engineering-manager.md)'s round-two rule — discovery
is closed on this stage; only the fixes are in scope.

**The tolerance was wrong twice, and the second correction was not mine.** I told the implementer it
must exceed collection jitter (~70s). Six live collections refuted that: the implied deadline holds
to **72 milliseconds**, including across a **130-second gap where a collection was missed entirely**,
because jitter *cancels* — the producer derives `secondsLeft` from a real deadline, so both terms
move together. The implementer then named the term that actually moves it, which neither of us had:
**the difference in collection duration between two snapshots**, since the countdown is read early in
a run and `collectedAt` is stamped at its end. 95 ms in the new capture, ~2.1 s in the old one, ~5 s
worst case. Hence 10 s.

And the mutation that survived the first sweep was **that constant**: raising 10 s back to 120 s left
the entire suite green, because every constructed restart moved the deadline by minutes. **A constant
is code**, and this is the stage's own lesson landing on the stage.

**S3 met its bar and got smaller than planned.** 35 tests, 15 mutations, 15 caught. The two that
survived the first sweep were both real: a checkpoint written straight to its final path — now caught
by asserting the **inode changes**, which is the observable difference between rename-replace and
write-in-place — and a **relative `meta.dir`** accepted in a checkpoint, which is Sol's S2-06 arriving
on the recovery path it was always about.

Three of its calls are worth keeping in this file rather than only in the code:

- **`foldEvents` is exported and the register is a fold of the log.** That is what makes
  disposability a property of the code rather than a promise: a rejected checkpoint costs a replay,
  not a fleet.
- **`opening.start` is `cold | rebuilt | resumed`**, three arms because a daemon that replayed a
  thousand events has a baseline and must not announce itself as cold — the same distinction this
  codebase keeps drawing between having looked and being unable to.
- **The caller never supplies the register.** `checkpoint()` takes it from the store's own fold, so a
  caller cannot write a checkpoint that disagrees with the log.

**A finding the plan did not have: `lastSeenAlive` can only be a floor, never a reading.** With
events-not-samples, an idle session emits nothing for hours, so liveness is `lastGoodSnapshotAt` plus
register membership. **Anything rendering "blocked for 40 minutes" from `lastSeenAlive` alone is
wrong** — and that is exactly what triage will reach for first, which is why it is written here and
not only in a comment.

**S6's fixtures are the best artefact of the night, and the reason is that they are real.** A
dispatched `codex exec` sits **eight levels below the pane**: pane → `claude` → the Bash tool's
`bash -c` → `timeout` → `npm exec` → `sh -c 'tsx'` → `node .bin/tsx` → `node --require preflight.cjs`
→ `codex exec`. A hand-written fixture would have put it at two or three and the classifier would
have been built to look there. Three more that kill an obvious implementation: **five processes in
that chain carry `run-codex.ts` and exactly one carries `codex exec`**, so a recogniser matching the
wrapper counts one review five times; **one pane held three concurrent Bash-tool children**, two of
them running `sleep`, so *"is there a bash under this pane"* says nothing; and **the pane can be
older than its Claude** — 115341 s against 75741 s — so pane age is not session age.

**S6's answer is zero, and a zero needs its positive control recorded beside it — permanently.** The
fleet dashboard agent's point, 2026-09-08, and it is the right correction to how this result was
about to be filed:

> A metric that can honestly be zero needs its *positive control* recorded next to the number,
> permanently, not just at the moment of building. In six weeks the number will be in a dashboard and
> the control will be in a session transcript nobody can find.

So, beside the zero: **the live control** was a `vitest` deliberately started under the measuring
agent's own pane, caught by 2 of 8 probes at depth 5 with a correct age; and **the durable controls
are in the suite**, as real captures with real child work under them —
`tests/fixtures/overseer-process-trees/codex-review-under-pane.txt` (a paid `codex exec`) and
`shell-pane-running-tests.txt` (a suite 21 minutes in). Those are what make "zero" mean *there was
none* rather than *we stopped finding any*, and they are the reason this result can be trusted
without re-reading this file.

**The general shape is worth naming: a metric that can legitimately be zero is indistinguishable from
a broken one**, which is this codebase's recurring failure wearing a third face — after the check that
reports success while doing nothing, and the guard whose silence is not evidence. The answer is the
same each time: make the instrument prove it can still see.

**And the arm's yield may go to zero permanently, which would not be a regression.** Whether any
session is caught depends on how agents happen to dispatch reviews — a backgrounded review after the
turn ends, rather than a foreground one during it — and that is a habit, not a property of anything.
Written down so that a future zero is not read as a fault.

**The duplicated stage, and whose fault it was.** `worktree:check` could not see a running process,
and both agents fixed it. Theirs landed (`f3817060`); mine was discarded, its diff kept at
`scratchpad/mgr-agentD-worktree-check.patch`. **The cause was mine**: I told the dashboard agent the
gap was *"worth a line in your plan doc"* and never said I was fixing it, which is
[announce before taking a queued slice](../reusable/engineering-manager.md) failing in the one
direction a shared public finding makes easy. Two measurements from the discarded work are worth
keeping, because they independently justify the design that landed: **`/proc/<pid>/cwd` is unreadable
for 575 of the box's 910 processes**, and **a cwd-based rule fired on 8 of the box's 13 worktrees**
against 2 that actually had servers — so "listening processes only" is not a shortcut, it is the
correct signal.

### The order, reconsidered — and the constraint that deleted work

Greg, 2026-09-08: *"Reprioritise as you see fit, work in parallel where you can."* Three changes.

**S2's P0 is not negotiable and nothing follows it.** It is landed code that can write a history
that is plausible and false, and S3 is the stage that writes histories to disk. Fixing it after the
store exists means the store's first real test writes corrupt history.

**S3 got smaller, because of a constraint from the dashboard agent.** Greg's robustness ceiling —
*"if the orchestrator broke I could just ssh in and use Claude Code in the terminal"* — was read back
as a design rule: **no state that only this process knows how to reconstruct.** So the store is
**disposable**. If `~/.overseer/` is missing, empty, or truncated, the Overseer starts cold, says so
plainly, and runs. It never refuses to start, and there is no repair step. That deleted a whole class
of recovery machinery this plan was about to acquire.

> *disposable* has to include **truncated**, not just missing. A file cut off mid-line by an OOM kill
> is the case that actually happens here, and it is the one that tempts a repair step. If a
> half-written last line costs you the last line and nothing else, you have it right.
>
> — the fleet dashboard agent, 2026-09-08

**S6 is new, and it is the only part of § `idle` is the bug that needs nothing from anyone else.**
Four live sessions were mid-`codex exec` and every one of them showed as `idle`. That is mechanical,
not a judgement, so it is buildable today — and it does **not** need an arm on `SessionState`. The
seam both agents agreed on:

> **The dashboard reports the pane; the Overseer decides what the work is.** `panePid` is a fact
> about a pane; "this session is waiting 40 minutes on a paid review" is a judgement about work, and
> judgements belong on the Overseer's side. Adding a `SessionState` arm would encode a conclusion in
> a field whose whole job is to report an observation.
>
> — agreed between this agent and the fleet dashboard agent, 2026-09-08

So S2-fix, S3 and S6 run in parallel; S4 and S5 follow, in that order, because S5 is the stage that
actually answers Greg's opening requirement — *a way to (re)start it if it gets killed*.

### A fact that landed underneath this stage: a session can be renamed

`POST /api/sessions/rename` landed on 2026-09-08, after S2. **A session's name can now change without
`gjd-remote ls` having run**, and renaming also clears `GJD_PROVISIONAL` — without which `adoptTitles`
renames it straight back.

This does **not** break the diff: `SessionIdentity` is the tmux handle plus `claimedConversationId`
and has never included the name, which is the same conclusion for the same reason as the
`claudeSessionId` correction above. Two consequences it does have:

- The register must hold the name as **last observed**, refreshed every snapshot, not written once at
  first sighting — otherwise reboot recovery offers Greg a name he deliberately changed.
- **A rename currently produces no event at all.** It is a deliberate act by a person and it is
  invisible to the history. Folded into S2's review round rather than opened as its own stage.

### S3 — the store: single writer, checkpoint, crash recovery

- One `events.jsonl`, truncate-to-newline on open, the exclusive lock, and `current.json` as a
  checkpoint with register, cursor and both clocks.
- **Done:** the full torn-write sequence — tear, restart, append, append, read — and a second daemon
  refusing to start. Not "a torn line is skipped".

### Where the hardening stopped, and how we knew

Three review rounds on one mechanism — the types carrying *this snapshot passed the gate* and *this
may stand as the world*. Round three found the private-field box still hands out the live object, so
`Object.assign(baseline.snapshot, { tmuxServerPid: null })` compiles with no cast. Rather than fix
it, this went to **Fable**, per
[engineering-manager.md](../reusable/engineering-manager.md)'s rule that a P0 surviving round two is
settled through Fable or Greg rather than past the orchestrator. It was the first time that clause
was needed.

**The verdict: stop hardening the type.** Take a small honest patch — a result union, one runtime
assertion, three corrected comments — and decline the deep freeze.

**Why the freeze is a ghost, with evidence rather than intuition.** Round two's hole was real
*because the spread is this file's own idiom*: `{ ...snapshot, clock: snapshot.clock }` sits at
`admissible.ts:154`, so an agent forging a brand by spread was doing what the surrounding code does.
Round three's needs somebody to write `Object.assign` onto a value typed `readonly`. Fable grepped
`daemon.ts`, `store.ts`, `notes.ts` and `work.ts`: **no production code mutates a snapshot anywhere**,
and the one realistic site — a test mutating a fixture — cannot leak, because `freshFixture` re-parses
per call. The freeze also had an unpriced cost: it would freeze structures shared with the store's
register and walk opaque `question`/`health` JSON, which is more surface than the thing it guards.

**The loop diagnosis, which is the part worth carrying elsewhere:**

> Rounds 2 and 3 are the same finding at increasing resolution. TypeScript's `readonly` was never
> runtime immutability, so asking a reviewer *"is it sound?"* will always get the next level down.
> Freeze it and round 4 finds `structuredClone`-then-forge. That is convergence to a known limit, not
> a chain of misses.
>
> — Fable, 2026-09-08

**And the exit, which is a change of question rather than of code.** State the guarantee at its true
strength in the code, and ask the next review *"is this statement accurate?"* rather than *"is this
sound?"* — bundling it with the next stage rather than reviewing the mechanism alone. **A comment
stronger than the code is what misleads the next agent**, which is this stage's own recurring class
arriving in prose instead of in types. So three comments that overclaimed are being corrected, and
the uncovered case — a nested `row.status.secondsLeft = 3600` — is **written down as uncovered**
rather than covered.

The one runtime check that does land is at the use site, not the mint: `diff()` asserts `unplaceable`
on its `previous` once. **The type makes the guarantee at mint; JavaScript cannot hold a value still
between mint and use, so the use site checks once.** Sol's exact example becomes a crash rather than
a bridged reboot — correct-and-unavailable over plausible-and-up, at the one point where a mutation
could bridge two tmux worlds.

**And the redirection matters more than the ruling.** Fable's closing point is where the hazard now
actually lives:

> A wrong history is far more likely to come from the daemon's register folding, `goneWhileAway`, and
> the checkpoint/baseline write ordering than from anyone assigning to a readonly field.

That is where the next review goes.

### S3's review, and the premise in it that was wrong

[260908b-s3-review-sol.md](260908b-s3-review-sol.md). A P0 and four others; all five dispatched fixes
landed, and **one finding was rejected on its premise rather than fixed** — which is the part worth
keeping.

**S3-01 (P0) — the lock was not exclusive.** Rename-plus-read-back only catches contenders that
renamed before the read. Now `openSync(path, "wx")`: the kernel decides, in one syscall. The residual
is **named rather than hidden** — clearing a provably-dead pid's lock cannot be made atomic without a
primitive Node does not expose — and it is covered by a second line: **ownership is the lock file
itself, checked two ways.** Inode-and-device identity between the held fd and the path catches a
competitor's unlink-and-recreate *even when byte-identical*; the record's `instanceId` catches an
in-place overwrite, which keeps the inode. Checked before the log is repaired, before the append
handle opens, and before every write — so a start that lost the clearing race refuses rather than
truncating a log the winner is appending to, which was the worse half of the finding.

**S3-02 — replay is now all-or-nothing.** One unreadable line inside the range being replayed means
no fold at all. A hole *before* the checkpoint's cursor does not block a resume: those bytes were
folded when they were good, and refusing there would throw away a sound checkpoint over a line
nothing reads again. The framing that unlocked it — not a hostile-user boundary, but a **persistence,
version and corruption** boundary — is in the module comment, next to the sentence that makes the
strictness affordable:

> Every refusal in this file is affordable precisely because the thing on the other side of it is a
> working daemon with no memory.

**S3-06 — the cursor now saves work as a number rather than as a claim.** The checkpoint is read
first, the log only from the cursor, positionally. `StoreOpening` gained `bytesScanned`, and the
smoke run prints `Resumed … Read 0 bytes of the log.` A range too large to replay is a **cold start
rather than an attempt** — the restart-loop cliff removed instead of documented.

**And S3-04, which was rejected.** Sol's premise was that a resumed store must reconstruct a baseline
from what it holds. It must not, and cannot honestly: the register keeps `lastStatusKey` rather than
the status and has never held `title` or `question`, so anything minted from it carries **an invented
`collectedAt` for a collection that never happened** — plausible wrongness manufactured by the
recovery path, which is where it survives longest. The daemon instead persists **the producer's own
wire bytes** and, on restart, re-parses and re-blesses them through `parseObservation` and
`admissible()`.

> The register answers *what is running*. The baseline answers *what did the producer last say*.
> Different questions, and only the second is safe to re-derive, because we can keep the exact bytes.

That now sits on `SessionRegister` in the code, because the temptation will recur. **The fields the
register drops are dropped on purpose; that is what makes it safe, and it is a property to preserve
rather than a gap to close.**

**Two things about reviews follow from it**, and both agents reached them independently: a premise
from a cross-family review **can be wrong in the same way code can**, and it is easier to miss because
a finding arrives already framed as a defect with a fix implied. Sol found a real gap here — a
restart genuinely could not produce `working → idle` — and named the wrong repair. Taking the gap and
refusing the repair is the outcome to aim for.

**Mutations: 29 tried, 28 caught, and the survivor reported as an equivalent mutant rather than
banked as coverage.** Five of the original fifteen went **NO-OP** because their anchors had been
rewritten, and were re-anchored and re-run rather than counted — *a mutation that matches nothing
reports nothing*, which is this whole failure class in miniature.

**The sharpest finding of the round is about tests, not stores.** The mutant that removed the
absolute-path check really did create a directory in the repo root — **which then made the next run of
that test pass for the wrong reason.** A control that poisons its own verification is worth killing on
sight; that test now cleans up whatever happens.

### S4 — the source and the daemon

- SSE with poll fallback, the freshness watchdog, degradation and restoration events. **No health
  history and no local collection.**
- **Done:** run against the live dashboard and show the log and the checkpoint — real output.

**The staleness threshold is a measured number, not a guessed one, and getting it wrong is the
failure that teaches Greg to ignore the alarm.** Astra's A17 is that the dashboard's own client calls
data stale at 30s while collection waits 60s after a ~12s run, so *healthy operation spends most of
its time alarming*. Measured here over six consecutive collections, 2026-09-08 05:43–05:50 UTC:

- The interval is **65.0s**, very regular — not the ~70s the fixtures README claims, and not the
  60s `refreshMs` advertises.
- **One interval in six was 130s** — a collection was simply missed, with no error and no gap in the
  data. So a missed collection is *ordinary*, and any threshold under about 150s fires on a healthy
  fleet.

So the watchdog fires on a multiple of the **observed** cadence, and `refreshMs` is a hint rather than
the contract. A17's real lesson is not the number; it is that an alarm which is usually wrong is worse
than no alarm, because it is the same picture as a quiet page over a dead box.

**Degradation and restoration are events, and they pair with S2-01's held baseline.** The three ways
the Overseer can stop knowing things — the SSE dropped, the poll failed, and the generation went
unreadable so the baseline is held — are different causes with the same symptom, and the whole point
of this codebase's `unknown`-with-a-cause discipline is that they must not collapse into one silence.

**A third failure mode, found the hard way on 2026-09-08: the collector can simply stop.** The
Overseer's own sweep caught `/api/state` serving a `collectedAt` **30 minutes old with `error:
null`**. The dashboard agent found the cause and it is worth writing down in full, because the shape
recurs:

`collect()`'s child had `timeout: 60_000`, which sends **SIGTERM** — and a `bash` in uninterruptible
IO on a swapping box does not die on SIGTERM. `promisify(execFile)` then waited for a process that
was never coming back. The refresh loop chains from the *end* of each run, so it never reached its
next iteration. **Nothing threw**, so `error` stayed `null` and the last good `collectedAt` simply
stood.

So the source was **neither down nor lying — it had stopped**, and it was invisible for the reason
this area keeps rediscovering: *the thing that would have reported the failure was the thing that had
stopped.* A wedged collector and a quiet box were the same picture.

The producer now carries **`attemptedAt`** ([`tools/fleet/state.ts`](../../tools/fleet/state.ts)) —
when a collection was last *started*, as against when data last *arrived*, and set **before** the
attempt precisely so that it moves while a collection does not. Three readings:

| `attemptedAt` | `collectedAt` | what it means |
|---|---|---|
| fresh | stale | the source is failing — `error` usually says how |
| stale | stale | **the collector is down or wedged** — the case that was invisible |
| null / absent | — | never attempted, **or a producer too old to say** |

**That last cell is the trap.** `attemptedAt` is an added field rather than a schema bump, so a server
predating the fix sends nothing — and reading absent as *never attempted* would make an old server
look permanently wedged, which is the always-wrong alarm A17 warns about. **Absent must mean "this
producer cannot tell me".**

**This reversed a design call, and the reversal is instructive.** The S4 agent argued — and I agreed,
on the evidence then available — that *"the collector wedged"* and *"the payload is old"* are one
measurement from the consumer's side, and that splitting them would be two names for one number.
**With one clock that was right. With two clocks it is wrong**, because a failing source recovers or
reports while a wedged collector does neither, and they want different actions. The lesson is not
that the reasoning was bad; it is that a conclusion drawn from the fields that happen to exist is
only as durable as that set of fields.

**And the general rule the bug hands us**, in the dashboard agent's words, which now governs both
programs' tests:

> A promise that never settles is the one behaviour no real tmux can arrange — which is precisely why
> this had no test.

The failures worth defending against here are exactly the ones the real dependency **cannot be
persuaded to perform**. They must be injected, or they will not be tested, and "untestable" is
usually this sentence undiscovered.

**Blocked, and not an agent's to unblock: the live dashboard is running stale code.** Probed
2026-09-08 08:26 — the payload on `:8787` has no `attemptedAt`, so the process predates today's
fixes, including the collector fix and the two-column dialog parser. So the `needs-you` count on the
live page is still an undercount and **the `idle` re-measurement cannot be taken yet**. Restarting it
is Greg's. Noting rather than working around it, because a number taken now would be a number about
yesterday's code — and this is itself the argument for S5: with a unit, a restart is routine rather
than a decision.

**A read CLI ships with S4, and it is not a nicety.** After S1–S5 Greg has a daemon recording events
and no way to look at them — which fails his NOW goal, *"staying up-to-date on progress
automatically"*, while every stage passes. The dashboard owns the page and this stage does not build
one, so the simplest honest version is a command: what is the Overseer doing, and what has it seen.
It also makes S4's own "show the log and the checkpoint" criterion something a person can re-run
rather than something an agent pasted once.

### S5 — deployment that actually survives a reboot

**A system service with `User=greg`, installed by `infra/hetzner/provision.sh`** — not a user unit
(Sol F7, P0). A systemd *user* unit does not start at boot without lingering enabled, and nothing in
this repo enables it: the box would reboot while Greg was away and the Overseer would simply stay
down until the next login, with `Restart=always` never getting a chance to matter. The first draft's
`kill -9` test would have passed the whole time.

**And `ExecStart` must not point into a worktree**, which normal worktree removal deletes.

- **Done, all four:** enabled and active; `kill -9` recovery; **an actual reboot with no intervening
  login**; and the executable path proven to survive worktree removal.

**Measured on the live box, 2026-09-08 — the ground S5 stands on is worse than the plan assumed.**
There are **no systemd units on this box at all**: `/etc/systemd/system/` holds only stock ones and
`~/.config/systemd/user/` is empty. And the fleet dashboard — the Overseer's only data source — is
itself a `scripts/tmux-job.ts` job whose entrypoint lives **inside a worktree**:

```
421175  132280  sh -c ( env FLEET_BIND=... npx tsx tools/fleet/server.ts )
        > /home/greg/code/spideryarn2/.claude/worktrees/fleet-dashboard-v01/logs/tmux-jobs/…
```

Three consequences, none of them theoretical:

- **`npm run worktree:check` will call `fleet-dashboard-v01` safe to delete, and it is not** —
  provable from the type rather than guessed at. `CheckFacts` in
  [`scripts/worktree-check.ts`](../../scripts/worktree-check.ts) has no process or pid member, every
  field it does have is about version-control state or ignored files, and `blockers()` is a pure
  function of `CheckFacts`. So no care elsewhere can make it notice a running process. Removing that
  worktree takes down the page and the Overseer's source together —
  [worktrees.md](../project/worktrees.md)'s own warning arriving through a door it does not cover.
  **Being fixed in this run**, since long-running jobs out of worktrees are now normal here and this
  will recur.
- **Its ppid is `132280` — the tmux server, the same number we use as the generation marker.** So a
  reboot takes the tmux server, every session, and the dashboard, in one go. Which means the ceiling
  argument — *"if the orchestrator broke I could just ssh in"* — is currently doing more work than it
  looks: after a reboot there is no page to fall back **from**.
- So the unit S5 builds should be **generic**, and the dashboard should get one too. Offered to the
  dashboard agent rather than done unilaterally; the page's contents are theirs, the install-and-
  verify path in `provision.sh` is this stage's.

**And one honest consequence of the fix**, flagged rather than buried: an `ExecStart` in the primary
checkout means both processes run whatever is on `dev` at that moment, **including a red `dev`**.

**Greg settled that question the same evening**, and the answer supports this choice while narrowing
it. *"Briefly broken is fine for dev, have a slightly higher standard for the orchestrator and its
web interface, and a higher standard still for keeping things working in prod"* — so `dev` keeps the
licence, and a service tracking it inherits that licence rather than being entitled to refuse it. The
counterweight is the middle tier: **these two processes are held to a higher bar than the code they
happen to be running from**, which is why the unit's job is to come back up rather than to validate
what it is starting. Recorded in
[orchestrator-direction.md § A higher bar](../project/orchestrator-direction.md#a-higher-bar-for-robustness-here-than-elsewhere-and-its-ceiling).

**The reboot criterion cannot be met by an agent, and will not be claimed.** *"An actual reboot with
no intervening login"* means rebooting a box carrying ~27 live sessions and ~15 worktrees of other
people's uncommitted work. That is Greg's to run, not an agent's. What S5 *can* prove without it, and
what it will report instead: the unit is a **system** unit, `systemctl is-enabled` says `enabled`, and
the symlink is present in `multi-user.target.wants` — which is precisely the evidence Sol's F7 was
about, since the whole finding was that a *user* unit would show none of those. The reboot itself
stays outstanding and is named as outstanding.

**`Restart=always`, not `Restart=on-failure`** — the fleet dashboard agent's argument, 2026-09-08,
and it is the ssh-ceiling argument turned round:

> `on-failure` means a clean `SIGTERM` is treated as intent, and on this box the things that send a
> clean SIGTERM are not the service's owner: a stray `pkill`, an OOM reaper that got there politely,
> a tidy-up script, an agent killing what it thinks is its own process. Every one of those is a
> *mistake* being read as a *decision*.
>
> The asymmetry is what settles it. A wrong `always` costs a process you have to stop twice —
> annoying, thirty seconds, and the second stop is `systemctl stop`, which `always` respects. A wrong
> `on-failure` costs a service that is silently gone at exactly the moment nobody is watching, and
> the failure mode of *this* service is that its absence is invisible: **there is no page to tell you
> the page is down.** Take the loud failure over the quiet one.

With it, a `RestartSec` of a few seconds and a `StartLimitBurst`, so a genuinely broken build
crash-loops visibly in the journal instead of hammering a box that has already reached load 391 once.

**And the unit must not gate on a green `dev`**, which is the same agent correcting me:

> A dashboard that boots from a red `dev` and is wrong about two rows is still the thing you use to
> find out why `dev` is red; a dashboard that refuses to boot until somebody fixes `dev` is
> unavailable exactly when it is needed. Correct-and-unavailable beats plausible-and-up **for the
> data**, not for the process — being down is one command from recoverable only if you can see that
> it is down.

**Reboot-resume of the sessions themselves is O4, a later stage.** This one only makes it possible.

#### The four commands that finish S5, and why they are Greg's

**`sudo systemctl enable` is refused for agents on this box, and it was refused twice by different
mechanisms.** The building agent hit it, and so did the orchestrator afterwards from a different
session — so this is a standing property of how agents run here, not one session's quirk. Recorded
because the alternative reading (*"that agent's environment was odd, try again"*) would cost somebody
an hour.

**Neither of us created the symlink by hand with `ln -s`, and that was deliberate.** It would have
produced the exact evidence the criterion asks for — a link in `multi-user.target.wants` — while
working around the denial rather than around a false positive. A criterion satisfied by circumventing
the thing that was stopping you is not satisfied.

So, in this order, and the order matters:

```
# 1. Stop the hand-run daemon FIRST. It holds ~/.overseer/overseer.lock, and the unit
#    will refuse to start while it does — correctly, and it names the file when it does.
tmux kill-session -t s5-overseer2-0935-2399531

# 2. Enable and start. `--now` does both.
sudo systemctl enable --now overseer.service

# 3. The three things that say it is real. `is-enabled` alone is not enough:
#    the symlink is what a reboot actually reads.
systemctl is-enabled overseer.service
ls -l /etc/systemd/system/multi-user.target.wants/ | grep overseer
npx tsx scripts/overseer.ts status

# 4. And the one that proves Restart=always does its job, which nothing has yet observed:
sudo systemctl kill -s KILL overseer.service && sleep 8 && systemctl status overseer.service
```

**Step 4 is the one worth actually running**, because it is the only assertion in this stage that is
currently backed by a file rather than by a behaviour. `Restart=always` is asserted by the unit, by
`systemd-analyze verify`, by `systemctl show` and by a killed mutant in the test — and **nothing has
watched systemd restart it**. The daemon's own recovery from `kill -9` *has* been observed, twice;
what has not is systemd noticing and bringing it back. Those are different claims and only one of
them is evidenced.

**The fleet dashboard unit stays disabled**, separately and on purpose: `:8787` is currently served by
a `tmux` job, and two supervisors for one port is a fight where the loser's failure looks like a
crash. Its owning agent has asked to read the unit before it is switched on, and has agreed to hand
over when it is.

#### S5 as built, 2026-09-08

Two units, checked in at [`infra/hetzner/systemd/`](../../infra/hetzner/systemd/) and spliced
verbatim into [`provision.sh`](../../infra/hetzner/provision.sh) — verbatim because
`gjd-remote provision` copies that one file to the box and nothing else travels with it, so the
units have to live inside it and there are unavoidably two copies.
`tests/systemd-units.test.ts` compares them byte for byte; nine mutants, all killed.

Four decisions the brief did not settle:

- **`ExecStartPre` builds the fleet client only when `dist/index.html` is missing**, not on every
  start. An unconditional rebuild was proposed first and is wrong here: with `Restart=always` and
  `RestartSec=10` it is a vite build every ten seconds for the length of a crash loop, on a box that
  reached load 391 this morning. The price is named in the unit itself rather than left to be
  rediscovered — **deploying a client change means running `npm run build:fleet` in the primary
  checkout**, because a missing build fails loudly and a stale one does not.
- **`FLEET_BIND` is written out in full in the unit** (`127.0.0.1,100.92.255.119`), with
  `EnvironmentFile=-/etc/fleet-dashboard.env` over the top of it. Loopback alone is the quiet
  failure — perfect from the box, simply unreachable from the phone the tailnet address exists for —
  so it is not left to a file that could be missing; and the env file, written by provisioning from
  `tailscale ip -4`, is how the *next* box corrects an address that belongs to this one.
- **The rate limits differ between the two on purpose.** The Overseer gets ten tries five seconds
  apart; the dashboard gets thirty ten seconds apart, because at boot the tailnet address may not
  exist yet and every attempt before it does is a legitimate failure to bind.
- **`FLEET_ACT_ENABLED` appears in the dashboard's unit only as prose saying why it is absent**, and
  a `check` line in `provision.sh` asserts it is not a key. A unit is exactly the sort of file
  somebody skims and completes helpfully.

**Two things S5 did not achieve, and neither is a design question.**

- **The units are installed but the Overseer's is not enabled.** `sudo systemctl enable` is refused
  in this session — the worktree-isolation guard reads `enable` as a git subcommand, and the auto-mode
  classifier denies the privileged form. Writing the unit files was permitted; changing service state
  was not. So `is-enabled` says `disabled` and the `multi-user.target.wants` symlink is absent: the
  triplet that was to be the evidence is Greg's one command away and has not been produced.
- **The primary checkout is not a deployable artefact, and nothing keeps it current.** On 2026-09-08
  it sat at `0d93edbf` (06:52) while `origin/dev` was at `1af97e9b` — no `scripts/overseer.ts`, no
  `tools/fleet/web/dist`. So both units would have failed to start even if enabled. This is not a
  path problem that a different `ExecStart` fixes; it is that **updating the primary checkout is a
  deploy step nobody owns**. Written up in
  [hetzner-remote-server-box.md § The box's own services](../project/hetzner-remote-server-box.md#the-boxs-own-services);
  worth a stage of its own if the units are to mean anything after a reboot.

What *was* proved, by hand rather than by systemd, is the half that had never been exercised: the
production store. Every earlier run used a scratch root, so `/home/greg/.overseer` did not exist.
Running the daemon at the default root filled it — `events.jsonl`, `current.json`, `daemon.jsonl`,
`overseer.lock` — and `status` read a live heartbeat from it. A `kill -9` left `EXIT=137` and
`status` reporting `KILLED — … it never wrote a stopping note`; the next start reclaimed the lock
and **resumed from the checkpoint with 0 events replayed**, rather than re-announcing the fleet.
Idle cost, measured on the live box at load 38–52: **155 MB RSS, flat, and 2 seconds of CPU in 231
seconds of wall clock** — about one of those two is tsx starting up, so steady state is well under
1% of a core. That is the direction doc's "costs nothing when idle" turned into a number, and the
reason it holds is that the daemon consumes the dashboard's stream rather than collecting, so it
never pays the ~12s grep.

**One thing to do before the unit is first started**, because the store refuses a second writer
rather than writing beside it: stop the hand-run daemon that produced the evidence above —
`tmux kill-session -t '=s5-overseer2-0935-2399531'`, or `kill` its pid. It was left running because
a recording Overseer is worth more overnight than a tidy one; if it is still holding
`~/.overseer/overseer.lock` when `systemctl start overseer` runs, the unit refuses, crash-loops to
`failed`, and says exactly which file to remove.

**The reboot criterion remains outstanding and untested**, as this plan said it would: the box
carries ~27 live sessions and ~15 worktrees of uncommitted work, and rebooting it is Greg's to do.

### S6 — work, not panes: the Codex subprocess arm

Independent of S3–S5, and running in parallel with them.

The pure classifier takes a process-table snapshot and the pane pid; a thin adapter reads the real
table. Splitting them is the point — the judgement is testable against captured fixtures and the I/O
is not in it. **A pane pid that is null, dead, or unreadable is a "could not tell" arm carrying why**,
never "no subprocess found", which is a different claim and the dangerous one.

- **Done:** fixtures captured from this box's real process table, and a number — how many of the live
  sessions this reclassifies, checked by hand that they really are mid-review.

**Not in S6:** the prose-question case. *"Has this agent asked Greg something?"* is a judgement, not a
parse — ten of fifteen sessions genuinely waiting on Greg had ended their turn in full stops, and a
mechanical check found one of twenty-three. That one is the Overseer's short-lived model calls, later.

**Also not in S6, but now owned here:** the `needs-you` sub-kind. *An agent asked me something* and
*the harness wants a permission* are different work items — and on this box the second is nearly
always a **launch defect**, because auto mode should have handled it. So it is not a queue item for
Greg at all; the action is to fix how that session was started.

### S7 — the three findings that were reported rather than fixed

**Added 2026-09-08 evening, after the debrief said "done enough to stop here".** Greg's answer was
*"proceed autonomously with anything left to do"*, and this is what was left: three findings that
earlier stages **named honestly and did not fix**, each for the same good reason — the file was
landed and under review, and reopening it would have invalidated a review in flight. That reason
expired when the reviews closed, and a finding whose only remaining justification is *we were busy*
is a finding that has become a decision by default.

Also worth saying plainly, since it is the pattern: **all three were found by the agent building the
*next* stage**, reading the previous one to use it. That is the cheapest review in this whole plan
and nobody scheduled it.

**S7-01 — the register goes stale for any session that stays alive.** This is S3-03, widened. As
reported, a session renamed with identity and status unchanged emits no event, so every rebuild
returns the name Greg deliberately replaced. But `entryOf()` freezes `name`, `repo`, `worktree`,
`meta`, `startedAt`, `paneId` and `panePid` at first sight, and `session-seen` fires once — so the
name is the instance somebody noticed, not the class.

**A correction, and the wrong claim was mine.** The brief for this stage justified widening the arm by
saying *"`EnterWorktree` moves a session between worktrees and is common on this box"*. **That cannot
happen and this data source could not see it if it did.** `collect.ts:214` derives
`worktree: worktreeOf(s.meta.dir)`, and `meta.dir` is a tmux session environment variable **fixed at
creation** — `EnterWorktree` moves the *transcript*, which is a different file and not in this
payload. `observation.ts:503` already said so, in this repo, before the brief was written.

Caught by GPT Sol reviewing the built stage. By then the claim had travelled from my brief into a
commit message, into two lines of this document, and into a test fixture value named
`moved-by-enterworktree` — a test named after a thing that cannot occur. **This is
[an unchecked brief claim becoming a source comment](../reusable/name-is-evidence.md)**, in the exact
shape that trap is written down in: an orchestrator asserts a mechanism, a subagent has no reason to
doubt it, and it is load-bearing prose three commits later. The rule it argues for is unglamorous and
would have cost thirty seconds: **grep every named example before putting it in a brief.**

**The arm is not affected.** `name` genuinely does change on a rename, which is the case S3-03
reported, and `repo`/`worktree`/`meta` are still worth covering — a wrong *justification* is not a
wrong implementation. What is gone is one of the two examples that made the class look urgent.

**The shape was decided by measurement and by the producer's own source, not by taste**, because an
arm that fires on any row change re-creates the 52k-rows-a-day problem this design exists to avoid.
The fleet dashboard agent read the collector and settled most of it: `repo`, `dir` and `kind` are
tmux environment variables fixed at session creation, and a partial reading **fails the whole
listing** rather than producing a degraded row (GPT Sol's finding 8 on that file), so `repo`,
`worktree` and `meta` are safe to freeze and safe to cover. Two are not — `paneId` can be transiently
null because it is joined from a separate pane listing, so **a null is not a change**; and `panePid`
*changes legitimately when a pane is respawned*, which is a real fact about the world rather than
drift in a label, and deserves its own arm rather than being flattened into a rename.

**S7-02 — two parses of one payload, and the weaker one carries the freshness logic.** `tools/fleet/`
emits `attemptedAt` — when the collector last *started*, as against `collectedAt` when one last
*succeeded* — and the pair is what distinguishes *wedged mid-attempt* from *gone*. It exists because
a collector wedged for thirty minutes reported `error: null`. `observation.ts` does not parse it, so
`daemon.ts` reaches back into the raw record with its own helpers. That breaks the rule
[typechecking.md](../project/typechecking.md) states: **the guard must read the thing it is guarding,
not a copy of it.**

**S7-03 — one append-only-log discipline, implemented twice.** `notes.ts` carried a comment admitting
it: *"`store.ts` keeps its `repairEventLog` private, so this is a duplicate of a subtle rule rather
than a reuse of one."* (That name is gone — the function is `truncateToLastLine` in `jsonl.ts` now —
but the quote is what the file actually said.) Truncate-to-last-newline on open, the single `O_APPEND` write, the atomic
replace. **A duplicated subtle rule is the kind that drifts dangerously**, because the copy that goes
wrong is the one nobody was looking at — and the rule here is the one that stops a torn line welding
a good record onto a corrupt one.

**S7-04 — `statusSince` is a lower bound wearing a measurement's clothes.** Found 2026-09-08 by
looking at the Overseer's own output the first time it ran against `~/.overseer`, not by reasoning:

```
working  13m  fb2f-dock-always-visible-landscape
working  13m  fb2g-gutter-icons-on-touch
working  13m  get-ready-for-deploy
working  13m  html-ingestion-post-processing-evals
```

Every row said 13m. **The daemon had been up for 13 minutes.** Those sessions had been working for
hours.

`statusSince` is set from the `at` of whichever event created the register entry, and for a session
already running when the daemon starts, that event is `session-seen` — first *observation*, not the
transition. Its doc comment says *"when it entered that state"*, which is true only for entries
created by a `session-status` transition the daemon actually watched. For every other entry it means
*"the earliest moment we can prove it was in this state"* — a different quantity with the same units
and no way to tell them apart.

**Three things make this worse than an off-by-something.** It is worst exactly when it matters:
`Restart=always` makes a daemon restart routine, and after one, every session's duration resets to
zero *together*, so the agent genuinely blocked for three hours ranks equal-last with one blocked for
thirty seconds — on the surface whose entire job is to rank by that. It is **silent**: nothing in the
shape distinguishes the two cases, so a renderer cannot tell and will present a floor as a fact. And
it is the seam's **headline claim** — [orchestrator-direction.md](../project/orchestrator-direction.md)
says `statusSince` is what turns a state into a duration and is what collection structurally cannot
produce, which is exactly the sentence that made the dashboard agent want to build on it.

**The fix is to make the distinction unrepresentable-away**, not to document it: `statusSince` becomes
a discriminated pair — one arm for a transition the daemon observed, one for the first sighting of a
state already in progress — so a renderer *cannot* accidentally show a floor as a measurement and can
at worst choose to. Same move as every "I could not tell" arm in `health.ts`, pointed at the one field
that had escaped it. The dashboard has been told not to build a renderer on the current shape.

**And note how it was found**, because it argues for a habit rather than a rule: the code was correct
against its tests, the type was right, and three reviews had been through this file. What exposed it
was **running the thing and reading its output as a stranger would** — four identical numbers in a
column, which no test asserts about and no reviewer sees.

#### S7-01, as built: two arms, and the measurement that decided the split

**The measurement, because the hazard here is an arm that fires every collection forever.** 25
collections of the live fleet from `GET /api/state`, one a minute over 24 minutes (2026-09-08
08:22–08:46 UTC), 20–25 sessions per snapshot, **516 same-identity row comparisons** — pairs of
consecutive snapshots in which `tmuxId` and `claimedConversationId` both held still:

| field | changes in 516 comparisons |
|---|---|
| `name` | 0 |
| `repo` | 0 |
| `worktree` | 0 |
| `meta` | 0 |
| `startedAt` | 0 |
| `paneId` | 0 |
| `panePid` | 0 |
| `title` | 0 |
| `question` | **4** |

**What that does and does not prove, said plainly, because it is easy to read the wrong way round.**
24 minutes bounds FLAPPING only weakly and is far too short to observe the events these arms exist to
catch — nobody renamed a session inside the window. (An earlier draft said *"or ran `EnterWorktree`"*;
see the correction above — that is not an event this source can see at all.) **And "0 of 516 changes"
bounds less than it looks:** on a generous independent-binomial reading the 95% upper bound is near
**0.58% per comparison**, which across a fleet-day is potentially hundreds of events. So the arm's
safety rests on the **source** argument, with the measurement only closing the volume question:
`repo`, `worktree` and `meta` derive from tmux session environment variables set at creation, and a
partial reading fails the whole listing rather than degrading a row, so they cannot move while the
session lives. The numbers say the log will not fill; the source says the fields are real.

`question` is the control, and it is the reason the arm is not "any row difference": it appeared and
disappeared twice inside 24 minutes, on two sessions, and neither is reboot-resume material.

**Q13's `repo` claim does not reproduce, and that is a correction rather than a null result.**
[open-questions.md](../project/open-questions.md), § Q13, records `repo` arriving as the repo,
`null`, the literal string `"unknown"`, and a different repo, all within one snapshot. Across **551
row observations** here it took exactly two values — `spideryarn/reading2` (526) and
`spideryarn/hellozenno` (25) — with no `null`, no `"unknown"`, and no version-1 `meta` carrying a
null repo. Two repos in one snapshot is not the finding; it is two sessions in two checkouts, which
is correct. So whatever produced that observation was not this field on this endpoint, and the Q13
bullet should be re-checked before it is written into a `docs/reusable/` note as evidence.

**Two arms, not one, and the split is the source's rather than mine.**

- `session-row-changed` carries `name`, `repo`, `worktree`, `meta`, `startedAt` — the ordered
  `REGISTER_ROW_FIELDS` in diff.ts — plus the whole row and a **typed** list of which of them moved.
- `session-pane-replaced` carries the pane on its own, because `panePid` changing is the thing
  `tools/fleet/steer.ts` compares before it types: the pane somebody was looking at has been
  respawned and another process wears its handle. That is a fact about the world, not drift in a
  label, and putting it on an event with a `name` field would describe a rename.

**A null pane is not a change, in either direction as far as silence goes.** `paneId` and `panePid`
are joined onto the session from a separate pane listing, so a join miss yields null on a session
that is perfectly alive — 0 misses in 551 observations here, which bounds the frequency without
removing the case. A pid going away is silence; a pid arriving or changing is an event, because a
register that never learns the pane cannot steer it.

**`statusSince` is the trap, and the fold does not touch it.** `entryOf(event.row, …)` is the
tempting one-liner for the new arm and it rebuilds the whole entry, so a session renamed after forty
minutes of waiting comes back as having waited none — and every triage view that ranks by "waiting
longest" silently reorders. It is invisible to a test that checks the name, so there is a test for it
and a mutation that reintroduces it.

**The forcing function, which is what S3-03 was really asking for.** `ENTRY_FIELD_OWNERS` in store.ts
is a `satisfies Record<keyof RegisterEntry, …>` census: a field added to the register is a compile
error until somebody says whether it is identity, row material, pane or clock. `rowMaterialOf`
returns `Pick<RegisterEntry, RegisterRowField>`, and a test ties the census's row half back to the
list the differ watches. One name added in one place cannot pass all three.

**Mutations: 19 tried, 19 caught — and one of them only after it survived.**
`rowFieldMoved("startedAt")` returning `false` passed the entire suite, because every other test
edited some other field, so a watched field nothing exercises is not really watched; the test that
closes it says so. **Four first-round runs were VOID rather than caught** — a vitest killed under
load on this box exits non-zero with a log full of ticks, which is indistinguishable from a mutant
found unless you insist on the summary line — and were re-run alone.

*(The commit message for `5627f6c1` says 526 comparisons; the finished run says 516. The larger
number was read off a partial capture and the smaller one is right.)*

#### S7-03, as built, and the difference that mattered

`tools/overseer/jsonl.ts` now holds truncate-to-last-line, the `O_APPEND` single write and
`writeAtomically`, used by store.ts and notes.ts. **The two copies had already drifted**, which is the
argument for the extraction rather than against it, and every divergence resolved towards store.ts:

- notes.ts's append loop was `while (written < n) written += writeSync(…)` with **no check that the
  count was positive**. `writeSync` returning 0 is the rare case the loop exists for, and there it is
  an infinite loop inside the daemon rather than a torn line.
- notes.ts did not `fsync` after truncating, so a machine dying between the repair and the first
  append came back to the torn line the last start thought it had removed.
- notes.ts kept `droppedBytes` and threw the dropped text away.

`LogRepair` and `NoteRepair` are one `JsonlRepair`. Two names for one fact is how the rule came to be
written twice. No test was edited; five mutations on the extracted module were all caught, and the
one that reports a torn file as clean fails in the **notes** suite as well as the store's, so both
callers really are exercised through it.

**What this stage is deliberately not.** It is not new capability. Nothing here makes the Overseer do
anything it could not do this morning; it closes three gaps between what the code does and what the
plan says it does. That is the right shape for the last stage of a plan and the wrong shape for a
first stage of the next one.

## What this stage is not

No steering, no scheduling, no killing, no page, no usage-limit reading, no second collector, and now
no health history either.

## The simpler options passed over

- **Do nothing; let the dashboard grow a store.** Rejected by both agents: it is deliberately
  stateless and its author has no plans to persist anything.
- **Sample every tick instead of diffing.** Rejected on volume and on readability.
- **Put the store in `data/`.** Rejected: worktree deletion, per-checkout fragmentation, and the
  not-Spideryarn principle.
- **SQLite now.** Rejected; the conditions that would change it are named above.
- **Daily file rotation.** In the first draft, removed after review — it cannot be made safe before a
  checkpoint exists.
- **A local `collect()` fallback.** In the first draft, removed after review — different contract,
  and it does not honestly reduce load.
