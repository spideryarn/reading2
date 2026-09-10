# Durable action receipts for the fleet dashboard

**Status, 2026-09-10: planned, not started.** Queue item `qi-zabqe99q`, dispatched by the Overseer.
This is the roadmap stage
[260908f § Durable action receipts — restart without guessing or repeating a write](260908f-overseer-and-fleet-improvement-roadmap.md#stage-durable-action-receipts--restart-without-guessing-or-repeating-a-write),
and it absorbs [260908j § Stage 5 — request ids and receipts](260908j-delivery-receipts-and-honest-outcomes-for-the-fleet-dashboard.md#stage-5--request-ids-and-receipts),
which was specified as instance-scoped and never built. This plan makes it durable.

## What the job is for

The dashboard accepts actions — a queued message, a direct steer, an answer to a dialog, a
broadcast, a kill, a worktree removal — and today nothing written down can say afterwards whether
an accepted action happened once, twice or never. The queue is memory (`queue.ts`,
`PERSISTENCE_WARNING`), so **a restart discards acknowledged work and records nothing**, and the
dashboard on this box restarts several times an hour. A phone that loses a response and presses
again sends a second message, because nothing recognises the first.

The acceptance sentence from the roadmap is the whole contract:

> restarting cannot silently drop acknowledged queued work or send an ambiguous message again. A
> receipt explains what is proven and unknown.

And the rule it sits under, from 260908j: *observed, inferred, claimed, unknown and not supported
remain distinguishable all the way to the browser. `keys submitted` is not `read`.*

This is the middle of Greg's three standards (2026-09-08): *"Briefly broken is fine for dev, have a
slightly higher standard for the orchestrator and its web interface, and a higher standard still
for keeping things working in prod."*

## The ground, measured

- **Every keystroke goes through one door**, `send-coordinator.ts`, which checks the quarantine book
  and writes a hold-ledger `attempt` record before calling the transport. A throw is never resolved,
  so a restart rebuilds a hold. That already covers *the session* after a crash; nothing covers
  *the action* — which request it was, whether it was queued, whether it finished.
- **The transport never observes reception.** `sendMessage` succeeds when its `send-keys` calls
  complete (`steer.ts:1381`); nothing afterwards reads the pane to see the message arrive. So the
  strongest proven state for a message is **keys submitted**. See § What this does not build.
- **Three kinds of producer**, with different shapes of effect:
  - *queued work* — `POST /api/actions/session` in `enqueue` mode, and the queued half of
    `POST /api/broadcast` via `enqueueSharedMessage`. Delivered later by `drain.ts`.
  - *direct keystrokes* — `POST /api/steer/message`, `/api/steer/answer`, and the send half of a
    broadcast. Synchronous (`execFileSync`).
  - *enacted plans* — `remove-worktree` and `kill-session` (session route, `runPlan`), and the box
    kills (`killRoute`). Async, with external effects outside any conversation. Behind
    `FLEET_ACT_ENABLED`, which stays off; they are built and tested with fake `ActionIo`.
- **Outside callers exist.** The Overseer posts to `/api/actions/box` (dry run only,
  `tools/overseer/rule-work.ts:172`) and its CLI posts to `/api/steer/message`
  (`tools/overseer/cli-state.ts`). `scripts/fleet-restart-plan.ts` reads the queues from
  `GET /api/actions` to report what a restart would discard. None of those files is in this file set.
- **The web client ignores `volatile`** and renders `queue.warning` verbatim
  (`actions-client.ts:413-426`, `ActionButtons.tsx:1581`), so the server can correct the warning's
  sentence without a client change.
- **There is a proven store to copy.** `hold-ledger.ts`: append-only JSONL in `~/.fleet-holds/`
  (0700), one writer by `tools/overseer/lock.ts`, a torn last line repaired at open by
  `jsonl.ts`'s `truncateToLastLine`, a `stillOurs` check before every append, compaction to the
  live records through `writeAtomically`, and a ledger that cannot write records the failure and
  **never stops a send**. Sixteen mutations, sixteen caught.

## The design

### Two ids, and neither is the other

- **`receiptId`** — the durable action instance id, minted by the server at acceptance:
  `<serverInstanceId>-r<n>`, the existing run-qualified convention (`instance.ts`), so it is unique
  across restarts. Distinct from the action vocabulary id (`compact`) and from the queue item id
  (`<run>-q<n>`), which a restart re-mints (see § Restoring the queue).
- **`requestId`** — the idempotency key, **minted by the client** once per intention (per button
  press) and reused on a retry of that press. Optional on every write route, so existing callers keep
  working; without one, an action still gets a receipt and simply cannot be deduplicated.

  **The id carries its mint time**: `rq-<ms since epoch, base36>-<≥16 random [a-z0-9]>`. That is
  what makes the retention rule safe rather than hopeful — see § Capacity and retention.

### The fingerprint (260908j's R5)

A sha256 over the canonical JSON of the request's **intent**: operation, target identity
(`sessionId`, `paneId`, `claudeSessionId`), speaker, and the payload — a hash of the message text,
the action id, or the option index plus a hash of the question and its options — plus mode,
`confirm`, the preview id for a box run, and `worktreeDir`/`branch`/`sessionName` for an enacted
session action, and the recipient list for a broadcast.

**Excluded, deliberately: `declaredStatus` and `panePid`.** They are observations the page
refreshes, and a retry of the same press after a refresh is still the same intention. Including
them would turn an honest retry into a conflict.

Same `requestId` and same fingerprint → the stored receipt comes back and **nothing happens**. Same
`requestId`, different fingerprint → `409 request-id-conflict`. **Both are decided after the body
is parsed and before the rate limiter and before any effect** — the limiter-before-lookup order is
what turned a promised receipt into a 429 in 260908j's review (`routes-steer.ts:1049`).

### The receipt's states

```
                    ┌──────────── returned (proven nothing sent; queued work goes back) ───┐
                    ▼                                                                      │
  accepted ──► attempted ──► keys-submitted        (transport completed every send-keys)   │
     │             │     ├─► completed             (an enacted plan passed every gate)     │
     │             │     ├─► plan-stopped          (a gate refused at step k; steps < k ran)
     │             │     ├─► not-sent ─────────────────────────────────────────────────────┘
     │             │     └─► outcome-unknown       (partial, unknown, threw, none-contradicted,
     │             │                                or found `attempted` at restart)
     │             └──── (crash) ──► outcome-unknown, written by the next run at open
     └─► withdrawn (a person cancelled or cleared it before it was attempted — proven not sent)

  outcome-unknown ──► reconciled { abandoned | released-as-sent | released-as-not-sent | … }
                      (a person's gesture; it never turns unknown into proven)
```

- **Every arm names its producer**, the rule 260908j cut three arms under. `keys-submitted`: the
  coordinator's `ok`. `not-sent`: `nothingWasSent`, the coordinator's `held`, or a plan refused
  before its first step. `withdrawn`: `cancel`/`clear`. `outcome-unknown`: the coordinator's
  ambiguous readings, a throw, and recovery at open. `reconciled`: the abandon route and the hold
  release route — **abandonment is a disposition on an unknown, never proof of non-delivery**,
  which is the distinction the roadmap asks for.
- **Terminal is terminal.** The journal refuses (and counts) a transition the machine does not
  allow, rather than writing it.
- **There is no automatic retry, anywhere.** A receipt makes a *deliberate* repeat safe; nothing
  repeats itself. `returned` is the existing `queue.release` hole — nothing was typed — and nothing
  else.

### The journal

`tools/fleet/receipt-journal.ts`, beside `hold-ledger.ts` and **over the same core**: the
single-writer JSONL machinery — lock, repair, strict line parse with a count of unreadable lines,
`stillOurs` before each append, compaction through `writeAtomically`, `status()`, fail-open with
`onTrouble` — is extracted from `hold-ledger.ts` into `tools/fleet/journal-file.ts`, and both stores
use it. The hold ledger's own tests must pass unchanged across the extraction; that is the proof it
is behaviour-preserving. A second copy of those two hundred lines would be the second scheme the
brief forbids, and the lock branch they contain is the one `health-history.ts` found surviving 102
tests when flattened.

- **Where**: `~/.fleet-holds/receipts.jsonl`, with its own `receipts.lock`, resolved by the same
  absolute-only `FLEET_HOLDS_DIR` rule. That directory is already *"the dashboard's record of its
  own actions"* by its own header, already 0700, already single-owner, and outside every worktree;
  the Overseer's `~/.overseer/` is never written.
- **Records**, all `schema: 1`: `accepted`, `material`, `attempted`, `progress` (one per completed
  plan step), `returned`, `outcome`, `reconciled`. The fold is per `receiptId`, in file order.
- **Journal before effect**: `accepted` is on disk before the 200 for queued work and before the
  first `await` or keystroke for everything else; `attempted` is on disk before the coordinator is
  called or the plan starts. Both are synchronous appends, so no handler interleaves.
- **Fail open, as the hold ledger does — with one exception that is closed.** A journal that will
  not open, is locked out, or cannot write does not stop an action; the response and the queue's
  warning say the work is not durable, `status()` carries the failure, and it reaches the log when
  it happens. Failing closed would make a full disk a reason the tool you reach for when things are
  broken cannot act.

  **The exception: a queued item whose `accepted` is on disk is never sent unless its `attempted`
  is on disk too.** Otherwise a failed `attempted` write, a send, and a crash leave a file that says
  *still queued*, and the next run restores the item and delivers it a second time — the one thing
  the acceptance forbids. So the drain asks `markAttempted` first, and if the write did not land the
  item stays queued, held with a reason the page draws (`not-durable`), and nothing is typed. An item
  whose `accepted` never reached the disk is not restorable and is sent as before, which is the
  fail-open case with nothing to duplicate.

### Sensitive text

Audit records never carry a word of a message: `what` is a description (`message (42 characters)`),
the fingerprint is a hash, and nothing stores `SteerResult.sent` (which is the argv, i.e. the text).
**The one exception is deliberate**: a queued free-text message needs its text to be delivered after
a restart, so a `material` record carries it — only for queued messages, only while the receipt is
not terminal. Compaction drops the material of every terminal receipt. File 0600, directory 0700.

### Restoring the queue

At startup, before any route or drain pass can run, the journal is folded and every non-terminal
receipt is concluded or restored:

- **`attempted` with no outcome** → an `outcome-unknown` record (`interrupted`), written by the new
  run so the file says who concluded it. **Not restored**: that is the never-retry rule. If the
  crash came after the coordinator's hold-ledger `attempt`, the hold ledger rehydrates a hold on
  that session too, as it does today.
- **`accepted` queued work** (including `returned`) → put back into the queue **with a new item id**
  minted by this run, keeping its `enqueuedAt`, speaker, conversation and payload, and a `requeued`
  note linking the receipt to the new id. A phone still holding the old id is refused as
  `other-instance`, which is already the right sentence. Staleness still counts from the original
  `enqueuedAt`; a re-arm (`revive`) is not journaled, so it reverts after a restart — the safe
  direction, and said so.
- **The tmux generation guards restored items.** `accepted` records the queue's known generation at
  enqueue (null before the first drain pass). The first `noteGeneration` after a restore invalidates
  every restored item whose generation differs **or was null** — an item that cannot say which tmux
  server it was queued against is not delivered on a guess.
- **Material missing or unreadable** → `not-sent` (`lost-at-restart`) with a sentence. Visible, not
  silent, and true: it was never attempted.

`volatile` on `QueueView` widens from `true` to `boolean`, and the warning's sentence says what is
true: durable when the journal is writing, the old sentence when it is not.

### Capacity and retention (260908j's R7)

- Retention: terminal receipts for **7 days**, and at most **5,000**; non-terminal receipts
  **never evicted**. Compaction runs when the file passes 1 MiB.
- A hard cap on non-terminal receipts (the queue's own caps bound queued work at 64; the hard cap is
  a backstop at 1,000) — past it, a new action is refused with a sentence rather than accepted
  unrecorded.
- **An expired id is recognised and refused, never treated as new.** At acceptance the id's
  embedded time must be within 1 hour of the server clock; a receipt is only compacted away 7 days
  after acceptance; so any `requestId` whose embedded time is older than *7 days − 1 hour* is refused
  as `request-id-expired`. Every id compaction could have forgotten is therefore refused, without
  keeping a tombstone for ever.

### The read surface

`GET /api/actions/receipts` — the most recent 50 receipts, every non-terminal one, and the
journal's status (durable, locked out, last failure, unreadable lines). `?sessionId=$123` — every
retained receipt for that target. A `ReceiptView` in `wire.ts` says, per receipt, **what is proven**
(accepted at, attempted at, keys submitted, steps completed) and **what is unknown**, in fields
rather than in one label. A small self-contained `ReceiptList.tsx` draws it.

## Stages

Each stage lands useful on its own. Implementation by GPT (`scripts/run-codex.ts`, workspace-write,
in this worktree) from a written brief; review by GPT Sol, write-capable, at the end of each stage.

### Stage 1 — the journal, and queued work survives a restart

- [ ] Extract `journal-file.ts` from `hold-ledger.ts`; the hold ledger's tests pass unchanged.
- [ ] `receipt-journal.ts`: records, strict parse, per-receipt fold with the transition rule,
  compaction with retention and material-dropping, `status()`, fail-open.
- [ ] Opened by `openSharedQuarantine()` beside the hold ledger — `server.ts` already calls it above
  `createServer`, and `tests/fleet-hold-wiring.test.ts` already keeps it there. A shared
  `sharedReceiptJournal()` that is memory-only unless opened, so a test that never opens it cannot
  write to the real `~/.fleet-holds/`.
- [ ] The queue writes its own receipts at every item transition — enqueue (`accepted` + `material`),
  `markAttempted` (called by the drain on the line before the coordinator), settle, `release`
  (`returned`), `quarantineLeased` (`outcome-unknown`), cancel/clear (`withdrawn`); abandon
  (`reconciled: abandoned`). Owned by the queue so no enqueue path — HTTP or broadcast — can skip it.
- [ ] Restore at construction of the action routes, before the first drain pass; the generation
  guard; `volatile`/warning made true.
- [ ] Crash tests (below) for queued work.

**Done:** a queued message accepted before a restart is delivered once after it; an item that was
being delivered when the process died comes back `outcome-unknown` and is not delivered again; the
hold ledger's suite is unchanged and green.

### Stage 2 — request ids, replay, and direct keystrokes

- [ ] `requestId` parsed on every write route; format and time window checked; lookup and conflict
  before the limiter.
- [ ] Receipts for direct steer and answer: `accepted` + `attempted` before the coordinator, outcome
  after, `not-sent` for a held session.
- [ ] Replay: `200 {ok: true, op: "receipt", replay: true, receipt}` for a known id and fingerprint
  (the receipt says whether it is still pending); `409 request-id-conflict`; `409
  request-id-expired`.
- [ ] Crash tests for direct steer, and a duplicate HTTP request after a restart.

**Done:** 260908j Stage 5's done-sentence, made durable — the same id and body posted twice, across
a restart, sends once and returns one receipt twice; a different body is refused before any effect.

### Stage 3 — enacted plans and the broadcast

- [ ] Receipts for `remove-worktree`, `kill-session` and the box kills: `accepted` before the
  first `await`, `attempted` before `runPlan`, a `progress` record per completed step, `completed` /
  `plan-stopped` / `outcome-unknown`. A crash mid-plan comes back unknown **with the steps known to
  have completed**.
- [ ] Broadcast: one parent receipt carrying the `requestId`, and per recipient a child receipt
  (a direct send, or the queued item's own receipt from Stage 1).
- [ ] Crash tests including a duplicate HTTP request after a restart for a kill and a worktree
  removal, on fake `ActionIo`.

**Done:** a confirmed kill or worktree removal whose response was lost cannot be run a second time
by re-posting it, before or after a restart.

### Stage 4 — reading receipts, and the clients sending ids

- [ ] `GET /api/actions/receipts` and `ReceiptView` in `wire.ts`.
- [ ] A reconciliation gesture for an unknown receipt of an enacted plan (a person checked; the
  statement is recorded as theirs, never as proof).
- [ ] `ReceiptList.tsx`, self-contained, with its test.
- [ ] The web clients mint and reuse a `requestId` per press — `actions-client.ts`,
  `steer-client.ts`, `broadcast-client.ts`. **Coordinated with `session-continuity` before
  editing**, since `useActions` is theirs; mounting the list in a host component is theirs too.

**Done:** a person on a phone can see, for the last fifty actions, which were proven, which were
withdrawn, which are unknown, and which unknowns somebody has since looked at.

## The crash points, and how a test crashes

A crash is simulated by **freezing the disk**: the journal's injected `writeLine` (the hook
`hold-ledger.ts` already has for tests) drops every write after the named point, and the fake
transport records keystrokes only up to it. Then every object is discarded and a fresh composition
is opened over the same directory — `tests/fleet-hold-restart.test.ts`'s shape, where the only thing
that crosses the boundary is bytes on a disk. A thrown error is not a crash: `catch` blocks run
after it and write things a dead process could not.

| Point | After restart |
|---|---|
| before `accepted` is written | no receipt; the request was not acknowledged |
| after `accepted`, before `attempted` | queued work: restored under a new id and delivered once. A direct send or a plan: `outcome-unknown` — see below |
| after `attempted`, before the coordinator | `outcome-unknown` (`interrupted`); nothing was typed, and the receipt says it cannot tell |
| between the text and the Enter | `outcome-unknown`; the hold ledger rehydrates a hold |
| after the send, before the outcome line | `outcome-unknown` — indistinguishable from the row above, and the receipt says so |
| during the outcome line (torn) | repaired at open; the last whole record decides, so `outcome-unknown` |
| after the outcome, before the HTTP response | the terminal receipt; a retry with the same `requestId` gets it back and sends nothing |

**Why a direct send found at `accepted` is unknown rather than `not-sent`.** For direct sends and
plans, `accepted` and `attempted` are written back to back with no keystroke between, so a crash
there typed nothing. But the journal fails open: an `attempted` write that *failed* lets the send go
ahead, and a crash after that send leaves the same file behind. The new run cannot tell a lost write
from a crash, so it says `outcome-unknown`. Queued work is different because the item was waiting in
the queue, not being sent — the drain writes `attempted` on its own line, later.

## What this does not build

- **`observed-reception`.** The roadmap lists it; nothing on this box can produce it, because the
  transport does not read the pane after sending. An arm no code can reach is decoration on a
  contract (260908j). The receipt's strongest message state is `keys-submitted`, and the type's
  comment says where `observed-reception` goes the day something observes it.
- **Exactly-once with tmux.** Impossible, and not claimed in code or on the page.
- **A second writer of `~/.overseer/`**, or any product-database table.
- **Unifying the hold ledger into the receipt journal.** The hold is a fact about a session's input
  box and the receipt a fact about an action; they are written at adjacent moments and could be one
  record, but merging them rewrites the proven file's fold for no behaviour anybody needs today.

## Not mine, and what it needs

- `server.ts` is not touched: the journal opens inside `openSharedQuarantine()`, which it already
  calls in the right place.
- `scripts/fleet-restart-plan.ts` will over-report "discarded" queued items once Stage 1 lands,
  because it does not read `volatile`. Safe direction; the Overseer should update it.
- The Overseer's CLI and `rule-work.ts` can send `requestId`s once Stage 2 lands; that is
  `tools/overseer/`, not this job.
- A dashboard restart is needed for any of this to be live.

## The simpler options passed over, and why

- **Keep the volatile warning.** The roadmap's own simpler option, acceptable for v1, and what
  260908j chose. Not enough now: the Overseer is about to take broader unattended actions, and the
  box restarts the dashboard several times an hour.
- **Instance-scoped receipts** (260908j Stage 5 as written). Makes a repeat safe within one server
  lifetime, which is the case a phone hits most — but not the case this stage exists for, a
  response lost to a restart.
- **Checkpoint the queue's whole state on every change** instead of journalling events. Simpler for
  the queue alone, but it records no receipt, and it has no record of the window between
  "attempting" and "done", which is the one the crash table is about.
- **Tombstones for every request id for ever**, instead of ids that carry their mint time. No clock
  in the id, but a file that grows without bound, which is a different bug.
- **SQLite or Postgres.** Refused by the roadmap's storage contract: *"JSONL + atomic checkpoints
  remain sufficient."*

## Needs Greg (decided by default, reversible)

- **Queued work now survives a dashboard restart and goes out after it without anyone re-arming
  it**, unless the tmux server changed or the item went stale. That is what the acceptance asks for,
  and it is a change in what the page promises.
- **Receipts are kept for 7 days** in `~/.fleet-holds/receipts.jsonl`, and **the text of a queued
  message is kept on disk until it is delivered, withdrawn or concluded**, then dropped at the next
  compaction.
