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
- **`repo` is not one value.** In a single 39-row snapshot: 35 `spideryarn/reading2`, one `null`, two
  the literal string `"unknown"`, and one `spideryarn/hellozenno`. Any logic assuming a single repo is
  wrong.
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

### S3 — the store: single writer, checkpoint, crash recovery

- One `events.jsonl`, truncate-to-newline on open, the exclusive lock, and `current.json` as a
  checkpoint with register, cursor and both clocks.
- **Done:** the full torn-write sequence — tear, restart, append, append, read — and a second daemon
  refusing to start. Not "a torn line is skipped".

### S4 — the source and the daemon

- SSE with poll fallback, the freshness watchdog, degradation and restoration events. **No health
  history and no local collection.**
- **Done:** run against the live dashboard and show the log and the checkpoint — real output.

### S5 — deployment that actually survives a reboot

**A system service with `User=greg`, installed by `infra/hetzner/provision.sh`** — not a user unit
(Sol F7, P0). A systemd *user* unit does not start at boot without lingering enabled, and nothing in
this repo enables it: the box would reboot while Greg was away and the Overseer would simply stay
down until the next login, with `Restart=always` never getting a chance to matter. The first draft's
`kill -9` test would have passed the whole time.

**And `ExecStart` must not point into a worktree**, which normal worktree removal deletes.

- **Done, all four:** enabled and active; `kill -9` recovery; **an actual reboot with no intervening
  login**; and the executable path proven to survive worktree removal.

**Reboot-resume of the sessions themselves is O4, a later stage.** This one only makes it possible.

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
