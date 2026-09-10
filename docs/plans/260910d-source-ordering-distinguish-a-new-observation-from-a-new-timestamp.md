# Source ordering: distinguish a new observation from a new timestamp

The roadmap stage is
[260908f § Stage: Source ordering](260908f-overseer-and-fleet-improvement-roadmap.md#stage-source-ordering--distinguish-a-new-observation-from-a-new-timestamp);
its four checkboxes and its acceptance paragraph are the spec, and this plan does not restate them.
Queue item `qi-pxwfpa4q`, dispatched by the Overseer on 2026-09-10.

## What is wrong today, in one paragraph

The Overseer daemon orders fleet payloads by **`collectedAt` alone** (`admissible.ts`): equal is a
duplicate, earlier is refused ("the clock went backwards"), later is a new collection. So a clock is
doing the work of an identity, and each way it can move without a new collection behind it produces
a wrong answer:

| What happens on the box | What the daemon does today | Why that is wrong |
|---|---|---|
| The box's clock is stepped back under a running dashboard | Refuses every collection until the clock passes the old high-water mark | The history stalls for as long as the step, then diffs across the gap; the freshness alarm fires about a dashboard that is working |
| The dashboard restarts and its clock was stepped back | Same refusal | A restart is ordinary; the refusal is not |
| A payload is re-published with a new `collectedAt` and the same collection behind it | Accepted as a new collection | `lastGoodSnapshotAt` moves, so the watchdog believes it measured something it did not — an identical-age reset presented as a measurement |
| A payload from a previous dashboard run arrives after the new run's | Accepted if its clock happens to be later | Diffed across two runs of the producer, which can flap sessions |
| An old error publication arrives after a newer success | "the dashboard's last collection failed" | A stale sentence about a failure that has already recovered |

The fix is for the producer to say **which run** composed the payload and **which collection** its
rows came from, and for the daemon to order by that. The clocks stay, for human ages.

## The contract

### Producer: one new required field on the wire, `producer`

```ts
// tools/fleet/wire.ts — beside FleetState, and a required top-level key on it
export type ProducerStamp = {
  /** Which run of the dashboard composed this payload: `serverInstanceId()`, INSTANCE_TOKEN-shaped. */
  instance: string;
  /** How many refresh turns this run has kept (success or failure). 0 before the first. */
  publication: number;
  /** How many successful collections this run has kept: the ordinal of the one `rows` came from.
   *  null exactly when `collectedAt` is null — never collected. */
  inventory: number | null;
};
```

- **Both counters advance in the same synchronous `keep()` call.** A success increments both; a
  failure increments `publication` only. Nothing can serialise the payload between the two
  increments, so no payload shows one moved and the other not. **`publication` counts kept
  outcomes, and it is not a revision number for the whole payload.** Health, `attemptedAt` and the
  checkpoint-derived feeds change between keeps — `attemptedAt` moves in `onStart`, before the
  collector is awaited, so a poll in that window shows the new attempt under the previous
  publication number (Sol, finding 3). None of them are ordering facts, and the Overseer does not
  compare them.
- **Shared by poll and stream by construction.** `/api/state`, the SSE initial frame and every
  broadcast all go through `statePayload()`, which reads the one ledger. **The initial frame is sent
  once any turn has been kept, not only once a snapshot exists** (`server.ts` today sends it only
  when `snapshot` is non-null, so after a failed first collection a poll sees publication 1 and the
  error while a new stream subscriber sees nothing — Sol, finding 2).
- **Invariants a consumer may check:** `inventory === null` ⇔ `collectedAt === null`;
  `inventory ≤ publication`; within one `instance` neither counter ever goes down; one `(instance,
  inventory)` pair always carries the same `collectedAt`, `rows`, `tmuxServerPid` and `tookMs`.
- **Where the counter lives:** a small `PublicationLedger` class in `tools/fleet/instance.ts`, which
  is already the module about "which run this is". It is constructed with an instance id rather than
  reaching for one, per that file's header, so a test can build two.

**Additive, not a schema bump.** `wire.ts`'s own rule is to bump `schema` when a consumer that
ignored the change would be *wrong* rather than poorer. **An old daemon ignores the new key and orders
by `collectedAt` exactly as it does today** — poorer, not wrong: today's `parseObservation` refuses an
unknown `schema` but ignores unknown top-level keys. An old browser tab can reconnect to a newer
server, and it is safe for the same reason: the client's parser also ignores fields it does not name.
`schema` stays `1`.

### Consumer: the ordering the daemon reads

`parseObservation` gains a field that, like `attempt`, **cannot fail the parse**:

```ts
// tools/overseer/observation.ts
export type SourceOrdering =
  | { kind: "stamped"; instance: string; publication: number; inventory: number | null }
  /** No `producer` key: a dashboard built before this plan. The explicit old-producer state. */
  | { kind: "unstamped" }
  /** Present and not a stamp this reader can believe — a producer defect, said in `why`. */
  | { kind: "unreadable"; why: string };
```

`unreadable` covers a non-object, an instance that is not `INSTANCE_TOKEN`, a counter that is not a
safe non-negative integer, `inventory > publication`, and an `inventory` whose nullness disagrees with
`collectedAt`'s.

### The gate: `admissible()` orders by run and collection when it can

`admissible(previous, next, retired)` — `retired` is the set of dashboard runs this daemon has seen
replaced, a required argument so a forgotten edge is a compile error. In order:

1. The payload did not parse → **reject**, as today.
2. **Both `previous` and `next` stamped**, compare by run and collection. When either is not stamped,
   step 2 is skipped and the clock rules in step 6 apply — today's behaviour, exactly:
   - `next.instance` is in `retired` → **reject**: a payload from a dashboard run already replaced.
   - Same run, `next.inventory` below `previous.inventory` → **reject**, named as out of order. This
     runs **before** the error check, so a stale error publication gets the sentence that is true of
     it rather than "the last collection failed".
3. `error` non-null → **reject**, as today.
4. Never collected → **reject**, as today. When the run is new, the sentence says so: a dashboard
   restart is normal, and "never collected" alone reads as a fault.
5. No `previous` → **accept**, as today.
6. Decide:
   - **Same run, same collection** → **duplicate**, whatever `servedAt`, `health` or `publication`
     say, provided the collection agrees. `collectionDisagreement` adds the clock to what it
     compares, so one collection wearing two `collectedAt`s is **rejected** as a contract failure —
     this is the re-stamped-old-snapshot case.
   - **Same run, newer collection**, or **a new run** → **accept**, whatever the clock did. A
     collection is newer because the producer counted it, not because its timestamp is larger.
   - **Not both stamped** → today's clock rules: equal is a duplicate (with the disagreement check),
     earlier is refused, later is accepted.

**Why a new run is accepted regardless of the clock.** The source is sequential and single, and a
dashboard process cannot change runs without restarting, so an unseen instance is a later run. A
previous run's payload arriving afterwards is the one case that could contradict that, and `retired`
is what refuses it.

**Why stamped-after-unstamped uses the clock and not "new run".** An upgrade from an unstamped build
to a stamped one is a restart, so treating it as a new run would be defensible — but so is a
stamped producer whose stamp was briefly unreadable, and the two cannot be told apart. The clock
rule is yesterday's behaviour and safe in both cases; the only cost is that a restart combined with
a backward clock step, at the moment of upgrade, stalls as it would have done yesterday.

### The daemon

- `retired` is held in `runOverseer` beside `accepted`: when an accepted stamped snapshot's run
  differs from the previous accepted one's, the previous run is retired. The set is bounded (last 16
  runs) because a daemon runs for weeks. It starts empty after a daemon restart, and that is safe
  not because the old dashboard is gone — restarting the Overseer does not stop the dashboard — but
  because the source is sequential (stream and poll never overlap, `source.ts`) and the restored
  `accepted` carries its run: the first payload from a new run B retires the stored run A, and
  anything from A after that is refused (Sol, finding 4).
- A stored baseline (`last-snapshot.json`) keeps its stamp, because the payload is stored verbatim,
  so a restored `accepted` carries its run and collection, and the first payload after a daemon
  restart is a duplicate rather than a re-announcement.
- **A new condition, `ordering`, for `unreadable` only.** It degrades when a payload's stamp is present
  and unbelievable, and is restored by the next payload that is either readably stamped or
  unstamped — unstamped is a supported fallback, so a rollback after one malformed stamp must not
  leave the alarm open for ever (conditions persist until an explicit restore; Sol, finding 5).
  **`unstamped` raises nothing**, and
  that is the design decision this stage is most likely to be asked about: an old producer is ordered
  exactly as well as it was yesterday. A condition about something no worse than before is an alarm
  that means nothing, which is the watchdog's own argument for its large threshold (`daemon.ts` §
  The freshness watchdog). The daemon logs the transition in its console instead. Neither the
  `collector` verdict nor `freshness` reads the stamp, so an unstamped producer cannot look like a
  stuck collector.

### Deploying

Neither side has to go first. Old daemon plus new dashboard: the field is ignored. New daemon plus
old dashboard: every payload is `unstamped` and ordered by the clock, as today. The Overseer needs a
**dashboard restart** for stamps to exist, and a **daemon restart** for them to be read; either
order is fine.

## Stages

Each stage is implemented by Codex (`gpt-5.6-sol --effort high`, workspace-write, in this worktree),
reviewed by GPT Sol at the end, and committed by me.

### Stage 0 — this plan, reviewed

- [x] Plan reviewed by GPT Sol (read-only), 2026-09-10: *ready with changes*, six findings, all
  accepted and folded into the sections above. Findings and dispositions below.

### Stage 1 — the producer stamp

Files: `tools/fleet/wire.ts` (the `ProducerStamp` type and the `producer` key only),
`tools/fleet/instance.ts` (`PublicationLedger`), `tools/fleet/state.ts` (`fleetState` and
`PayloadDeps` take the stamp, required), and their tests. **Two files outside the dispatched file
set, and I need both:**

- `tools/fleet/server.ts` — about four lines: construct the ledger from `serverInstanceId()`, call it
  in `keep`, and pass `ledger.stamp()` to `composePayload`. The composition root is the only place
  that can hand the stamp in; `state.ts` holding a module-level counter instead would be the global
  that `instance.ts`'s header argues against.
  The same file's `/api/live` handler also changes one condition: the initial frame goes out once
  the ledger has kept a turn, not only once `snapshot` is non-null (Sol, finding 2).
- `tools/fleet/web/src/types.ts` — one entry in the **declined** half of `FleetState`'s `Omit<>`,
  with its reason (the page orders by its own poll and stream and draws no age from the stamp).
  A new required wire key does not compile on the client until it is either parsed or named there;
  that is the mechanism working, not a side effect.

Tests, red first: the payload carries the stamp; a success moves both counters and a failure moves
only `publication`; a poll and a broadcast of the same state carry the same stamp; two ledgers in one
process have two instances; the old `parseObservation` accepts a stamped payload (additivity, proved
rather than asserted).

- [ ] Stamp on the wire, ledger, composition, server wiring, client `Omit`.
- [ ] Focused tests, typecheck, `build:fleet`; Sol review; commit.

### Stage 2 — the consumer orders by run and collection

Files: `tools/overseer/observation.ts` (`SourceOrdering`, parsed), `tools/overseer/admissible.ts`
(the rules above), `tools/overseer/daemon.ts` (`retired`, the `ordering` condition — nothing in the
usage pass), `tools/overseer/notes.ts` (the condition's name and its line in the list), and a new
`tests/overseer-daemon-ordering.test.ts` so this stage does not edit the large daemon suite.

Daemon tests, through the real parser, gate, differ and store, driven by a scripted source:

- **Duplicate poll and SSE payloads** — one stamp twice, via both, with different `servedAt` and
  `health`: one set of events, no condition.
- **Out of order** — collection 3 accepted, then 2: refused as out of order, no events from it; then
  4 is diffed against 3. A stale **error** publication after a newer success gets the out-of-order
  sentence, not "the last collection failed". *Red today.*
- **Clock moving backward** — same run, collection 2 stamped earlier than collection 1: accepted and
  diffed. *Red today* (refused as "went backwards"). The unstamped control keeps today's refusal.
- **One collection, a later clock** — same `(run, collection)` re-published with a later
  `collectedAt`: refused as a contract failure, and `lastGoodSnapshotAt` does not move. *Red today*
  (accepted).
- **Server restart** — run A collection 5; run B never collected (refused, the sentence names a new
  run, no closures); B collection 1 with the same rows and an earlier clock: accepted, **zero events**;
  then a late payload from A: refused as retired, no events. *Red today* for the clock and for A.
- **A genuine empty fleet** — stamped, collected, `rows: []`: every session closed out. Legitimate.
- **No silent deletion on an inadmissible empty sample** — `rows: []` never collected, with an error,
  out of order, or from a retired run: zero closures and the register unchanged.
- **Old producer** — unstamped payloads over a long run with a healthy collector: no `ordering`, no
  `collector`, no `freshness` condition, and today's clock ordering. Stamped then unstamped (a
  rollback) falls back to the clock.
- **Daemon restart** — a stored stamped baseline makes the first identical payload a duplicate.
- **Daemon restart across a dashboard restart** — persisted baseline from run A; the daemon starts
  while the dashboard is already run B with an earlier clock: B's first collection is accepted with
  zero events, A is retired, and a synthetic late A payload is refused (Sol, finding 4).
- **Unknown schema stays unknown** — a `schema: 2` payload carrying a plausible `attemptedAt` changes
  none of the attempt reading, ordering, `retired` or `accepted`. *Red today:* `take()` falls back to
  `parseAttempt(json)` on every parse failure, and `parseAttempt` does not look at `schema`, so a
  schema-2 payload can restore `collector`. Fix in `parseAttempt`: an unsupported schema is
  `reported: false` before any field is read (Sol, finding 1).
- **`ordering` transitions** — unreadable → unstamped restores it; unreadable → readable restores
  it; an unknown-schema payload neither raises nor restores it.

Unit tests for `parseObservation`'s three arms, each `unreadable` cause, `parseAttempt` on an
unknown schema, and `admissible()`'s rule order.

- [ ] Parse, gate, daemon wiring, condition.
- [ ] Tests red then green; focused suites, typecheck; Sol review; commit.

### Stage 3 — the store and CLI readers

Files: `tools/overseer/jsonl.ts`, `tools/overseer/store.ts` (`parseEvent`, `parseEventLines`,
`readEvents`), `tools/overseer/notes.ts` (`readNotes`), `tools/overseer/status-cli.ts`
(`readEventTail`, the notes line), `scripts/overseer.ts` (the `notes` and `events` commands), and
their tests.

- **Short reads (O-2 in 260908b).** Both `readSync` calls in `truncateToLastLine` assume a full
  buffer. One `readFully` loop; `truncateToLastLine` takes an optional reader so a test can hand it
  one that returns three bytes at a time. *Red today:* a short read hides the newline and cuts past
  valid records.
- **Known event payload validation (O-1 in 260908b).** `parseEvent` checks `key` against the key its
  `identity` spells, a row-carrying event's `row.id` and claim against its `identity`, and
  `session-replaced`'s `previousKey` against `previous`. **The pane rule O-1 names is not tightened:**
  `observation.ts` lets `paneId` be null beside a real `panePid`, so refusing that on disk would
  refuse events the differ legitimately writes — and `replay()` is all-or-nothing, so one refused line
  starts the store cold. For the same reason, **before this lands the new parser is run read-only
  over the live `~/.overseer/events.jsonl` (1,811 lines on 2026-09-10) and must refuse none of it.**
- **The CLI's own event parse.** `readEventTail` accepts anything with a known `kind` and an `at`,
  and `describeEvent` then dereferences `event.row.name`, so one malformed known-kind line crashes
  `overseer events`. It uses the store's parser instead. *Red today.*
- **`readNotes` error → empty.** A `daemon.jsonl` that exists and cannot be read returns *no notes*,
  and the CLI prints "the Overseer has written nothing about itself yet". It becomes a discriminated
  result with an `unreadable` arm; `overseer notes` prints the cause and exits non-zero, and
  `overseer status` says the notes are unreadable rather than inferring the daemon's standing from
  none.
- **A torn final line is not a corrupt interior line.** A lock-free reader can see an append in
  progress: a final segment with no newline. Today every reader counts it as unreadable, and
  `readEvents(fromByte)` hands back a `nextByte` past it, so a tailing reader's next read starts
  mid-line. One splitter in `jsonl.ts` returns complete lines and a separate `tornTail`; `readEvents`
  stops `nextByte` at the last newline; `readNotes` and `readEventTail` report the tail apart from
  `unreadable`. `replay()` at open still refuses both, because `openStore` truncates before replaying
  and a tail there means something unexpected. Tests hold the two cases apart for each reader.
- Readers stay lock-free, and bounded where they were bounded. `readNotes` and `readEventTail` read
  and parse their whole file before applying `limit` today — lock-free but not bounded — and that is
  left as it is: they are CLI readers, and the page load never reaches them. Nothing here adds a
  full-history parse to a page load: the dashboard reads only the checkpoint (Sol, finding 6).

- [ ] Short reads, `parseEvent`, `readEventTail`, `readNotes`, torn tail.
- [ ] The live-log check (read-only), recorded below with its count.
- [ ] Focused suites, typecheck, full suite via `tmux-job`; Sol review; commit; push.

## What this deliberately does not do

- **No change to wait-deadline arithmetic.** `waitRestart` subtracts two `collectedAt`s. Replacing
  that with a monotonic clock looked like the clock-correction fix and is the opposite: the countdown
  a pane shows comes from the same box's wall clock, so a step moves `collectedAt` and `secondsLeft`
  by equal and opposite amounts and the implied deadline holds still. A monotonic elapsed time
  would turn a backward step into a phantom `session-wait-restarted`.
- **The freshness watchdog still measures from `collectedAt`.** A forward step larger than five
  minutes will open `freshness` until the next collection arrives, about a minute later. That is a
  condition flapping, not a session transition, and it is recorded here as known rather than fixed.
- **Event `at` stays the producer's `collectedAt`**, so after a backward step the log's timestamps
  are not monotonic. Ages are read against the same box's clock, which stepped with them.
- **No new event bus, no new endpoint, no persistence of `retired`.**

## The simpler options passed over

- **Order by `collectedAt` and dedupe by a hash of the rows.** A hash says two payloads are the same,
  never which one is newer, and cannot see a restart.
- **One sequence rather than two.** A single publication counter cannot tell an error or health turn
  from a new collection without comparing rows, and comparing rows is what we are replacing.
- **Bump `schema` to 2.** An old reader ignoring the field is not wrong, so a bump would force a
  lockstep deploy for nothing.
- **An `ordering` condition for unstamped producers too.** See The daemon, above.

## Findings

### Stage 0 — plan review, GPT Sol, 2026-09-10 (*ready with changes*)

Each finding was checked against the code before being accepted.

1. **P1, unknown schemas were not fully unknown.** `take()` calls `parseAttempt(json)` on every
   parse failure, and `parseAttempt` never reads `schema`, so a schema-2 payload's `attemptedAt`
   could restore `collector`. Checked (`observation.ts` `parseAttempt`, `daemon.ts` `take()`).
   **Accepted:** `parseAttempt` refuses an unsupported schema before any field; a daemon test added
   to Stage 2.
2. **P1, the stream missed the failed-first-collection case.** `/api/live` sends its initial frame
   only when `snapshot` is non-null. Checked (`server.ts`, the `/api/live` branch). **Accepted:**
   the frame goes out once a turn has been kept; a poll/SSE parity test added to Stage 1.
3. **P2, `attemptedAt` does not ride under its turn's number.** **Accepted:** `publication` is
   defined as kept outcomes, and the prose now says so.
4. **P2, the daemon-restart rationale was wrong.** **Accepted:** the rationale is now the sequential
   source plus the restored run, and the A-then-B restart test is added.
5. **P2, `unreadable → unstamped` would leave `ordering` open.** **Accepted:** unstamped restores it.
6. **P3, two factual claims.** **Accepted:** additivity rests on both parsers ignoring unknown keys,
   not on client and server builds matching; `readNotes`/`readEventTail` are described as
   lock-free, not bounded.

## Status

2026-09-10 — Stage 0 done: plan reviewed by Sol, all six findings accepted. Stage 1 next.
