# Task: Stage 1b of plan 260910d — queued work writes receipts and survives a restart

Repo: this worktree (/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts). TypeScript
+ ESM, `tsx`, vitest. **Read first, in this order:** the plan
`docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md` (authoritative; § The design
and § The crash points especially), both plan reviews and the plan's review tables, then the code
Stage 1a built — `tools/fleet/journal-file.ts`, `tools/fleet/receipt-journal.ts`,
`tools/fleet/action-stores.ts` and their tests. Use 1a's API as built; where this brief names a
method that 1a named differently, use 1a's name.

**Read Stage 1a's review too** (`docs/plans/260910d-durable-action-receipts-stage1a-review-sol.md`):
its fixes define the semantics you build on. In particular: `accept()` without a `requestId` fails
open (memory, `durable: false`); `attempted()` for a durably accepted receipt returns `{landed:
false}` and changes nothing unless the line landed; `returned`/`outcome`/`reconcile` fail open in
memory; `withdrawn` refuses for durably accepted receipts whose record did not land.

Stage 1b wires the receipt journal into queued work. **Direct steer, answers, enacted plans and the
broadcast's direct sends are Stages 2–3 and are not touched here** — except that the broadcast's
queued half already goes through `SteeringQueue.enqueueMessage`, so it gets receipts for free.

## What to build

### 1. `SteeringQueue` owns its receipts (`tools/fleet/queue.ts`)

- `QueueOptions.receipts: ReceiptJournal` — **required, not defaulted**, for the reason
  `quarantine` is required (read that comment). Update every construction site: tests
  (`fleet-drain` ×5, `fleet-refresh`, `fleet-actions-route` ×2, `fleet-queue`, `fleet-quarantine`,
  `fleet-hold-restart`) pass a `memoryReceiptJournal(...)`; `realActionDeps` in `routes-actions.ts`
  passes `sharedReceiptJournal()`.
- `push` (every enqueue path): pin the material, then `accept` with op `queued-message`/
  `queued-action`, origin `enqueue` or `broadcast` (add an origin parameter; `enqueueSharedMessage`
  passes `broadcast`), actor `client-claimed` with the speaker, target including `tmuxGeneration` =
  `knownGeneration() ?? receipts.lastGeneration()`. **Only then** does the item enter memory. A
  capacity refusal is a new `EnqueueRefusalRule`. An unkeyed accept whose write failed still enqueues
  (fail-open) and the result says `durable: false`. Keep the item → receipt link private to the queue
  (a `Map<itemId, receiptId>`); **do not add a field to `QueuedItem`** — the client builds it field by
  field and a new required field breaks its build.
- `cancel` / `clear`: **write-ahead** — `withdrawn` (one record for all of a clear's receipts) must
  land before memory changes, for any durably accepted item; if it cannot, return a refusal the route
  turns into `503` and change nothing.
- `beginDelivery(sessionId, itemId)`: called by the drain after `next()` leased an item and after
  `sendable()` succeeded, on the line before the coordinator. Writes `attempted`. If the receipt was
  accepted durably and `attempted` did not land: clear the lease and return a refusal — nothing is
  typed. Otherwise ok.
- `settle(…, "delivered")` → outcome `keys-submitted`/`transport-ok`; `settle(…, "refused")` (the
  drain's undeliverable path, before any attempt) → `not-sent`/`undeliverable`; `quarantineLeased` →
  `outcome-unknown` with the reason from the hold's reading (`partial`, `unknown`, `none-contradicted`,
  `threw`); `release` (proven unsent) → `returned` with the refusal code; a new `noteThrew(sessionId,
  itemId)` → `outcome-unknown`/`threw` **with the lease left open**, exactly as today;
  `settle(…, "abandoned")` → if no outcome yet, `outcome-unknown`/`lease-abandoned`, then
  `reconcile(lease-abandoned, actor)`.
- `restore()` — called once by `makeActionRoutes` at construction, before anything else can reach the
  queue. Takes `receipts.restorable()`: each item back **under its original item id**, with its
  `enqueuedAt`, speaker, conversation and the pinned payload (a `SpokenAction` snapshot is used as-is,
  never re-resolved through `actionById`). Idempotent: an item whose receipt is already in the queue
  is skipped. The id sequence starts above every reserved queue item id carrying this run's token and
  skips any reserved id.
- `noteGeneration`: also tells the journal. **On the first observation after a restore**, every
  restored item whose recorded generation differs, or was null, or `recovery().generationUnproven` is
  true, is removed from the queue and concluded `not-sent` (`tmux-generation-changed` /
  `tmux-generation-unproven`). Items enqueued in this run keep today's behaviour.
- `snapshot().volatile` = `!receipts.durable()`, and `warning` says what is true: today's
  `PERSISTENCE_WARNING` when not durable, a new sentence when durable (queued items are written down
  and survive a restart of the dashboard, unless the tmux server changes or they go stale). Widen
  `QueueView.volatile` in `wire.ts` from `true` to `boolean`.

### 2. The drain (`tools/fleet/drain.ts`)

`deliverOne`: `sendable()` → `beginDelivery()` → coordinator. A refused `beginDelivery` is a `held`
outcome with a new `DrainHoldReason` `not-durable` (nothing typed; the item stays queued; it is not
a send slot spent). A `threw` attempt calls `queue.noteThrew`. The coordinator's `held` arm (the
unreachable floor) leaves the receipt at `attempted`, which recovery concludes as unknown — say so in
its comment; do not change what that arm does to the lease.

### 3. The routes (`tools/fleet/routes-actions.ts`)

- `makeActionRoutes` calls `deps.queue.restore()` right after the book check. `ActionDeps` does not
  grow a journal of its own: the queue owns it.
- `fromAnotherRun`: refuse a foreign-run id only when **no current item has that exact id** — the
  hold-release route's rule — for cancel, revive, abandon and clear. Rewrite its comment to say why.
- cancel / clear: a write-ahead refusal becomes `503` with a sentence.
- The enqueue response gains `durable: boolean`.
- **`GET /api/actions/receipts`** — read-only, GET/HEAD only, not logged per poll: `{ok: true, op:
  "receipts", schema: 1, durable, status, recovery, recent: ReceiptSummary[] (50), nonTerminal:
  ReceiptSummary[], unknownWithoutHold: {sessionId, receiptIds}[]}`. `ReceiptSummary` is a small
  types-only addition to `wire.ts` (receiptId, op, origin, actor, speaker, target, what, acceptedAt,
  state, reason, attemptedAt, outcomeAt, reconciled, queueItemId, materialDeletionPending) — never
  message text. **`unknownWithoutHold` is computed once, at startup**: receipts that recovery
  concluded `outcome-unknown` (`interrupted`/`recovery-blocked`) for a keystroke op whose session the
  rehydrated book is **not** holding. During a run the book always holds after an unknown send, so
  there is nothing to add later. Get it from `openFleetActionStores()`'s result.
- Any new `ActionErrorCode` must go in the existing union and status map; `npm run typecheck` covers
  the web client. **If the client stops compiling, stop and report — do not edit `tools/fleet/web/`.**
  Prefer an existing code where one fits.

### 4. `server.ts` — one call, authorised by the Overseer

**Re-read `tools/fleet/server.ts` immediately before editing; another session (`responsive-collection`)
is changing its health wiring.** Replace only the `openSharedQuarantine({ log: … })` call at ~line 200
and the two `for` loops printing its lines with `openFleetActionStores(…)` and loops printing that
result's lines, plus the import. In the comment block directly above it, correct
`tests/fleet-hold-wiring.test.ts` (which does not exist) to `tests/fleet-hold-restart.test.ts` and
say it now opens both stores. **No other line of `server.ts` changes.**

### 5. The source guard (`tests/fleet-hold-restart.test.ts`)

The test *"server.ts opens the quarantine above the listener, not below it"* (~line 402) becomes the
guard for `openFleetActionStores(`: it precedes `createServer(handler)`, its lines are printed, and
**`server.ts` contains no other opener** (`openSharedQuarantine(`, `openHoldLedger(`,
`openReceiptJournal(`), so the receipt journal cannot later be opened below the listener. Move the
existing composition tests in that file onto `openFleetActionStores`, and add one asserting the queue
built by `realActionDeps` is looking at the same journal. Correct the three `fleet-hold-wiring`
references in `tools/fleet/quarantine.ts` to `fleet-hold-restart`.

### 6. The composition moves to `action-stores.ts`, and the legacy opener goes

Once `server.ts` and the tests call `openFleetActionStores`, **`openSharedQuarantine()` has no callers
— delete it**, and move the composition (`openFleetActionStores`, `sharedReceiptJournal`, the reset,
the shared-lock ownership, the receipt-failure fallback) out of `quarantine.ts` into
`tools/fleet/action-stores.ts`, where the plan puts it. `quarantine.ts` keeps the book and exports only
what the composition needs to install a ledger (`installSharedQuarantineLedger`,
`sharedQuarantineWasOpened`, the state reset). Stage 1a's review: *"The move must carry the singleton
state, shared-lock ownership, installation helpers, and receipt-failure fallback together."* Grep the
whole repo (code, tests, docs) for `openSharedQuarantine` and `resetSharedQuarantineForTests` and
update every hit.

## Tests — each red first; say in your answer that you saw it red

`tests/fleet-receipt-restart.test.ts`, in `fleet-hold-restart.test.ts`'s shape (every object discarded
and rebuilt over the same directory; only bytes cross). **A crash is a frozen disk**, not a throw: an
injected `writeLine` that drops every write after the named point, and a fake transport that records
keystrokes up to it. Cover every queued-work row of the plan's crash table, and:

- a queued message accepted before a restart is delivered **once** after it (count keystrokes);
- one being delivered when the disk froze after `attempted` comes back `outcome-unknown`/`interrupted`
  and is **never** delivered;
- `attempted` cannot land for a durably accepted item → `not-durable`, nothing typed, still queued;
- cancel answered 200 stays cancelled across a restart; cancel whose `withdrawn` cannot land → 503 and
  the item is still there; clear writes one record;
- an old page's cancel of a restored item (original id, other run's token) succeeds before the next
  drain;
- a restored item with a different or null generation is concluded, not delivered;
- an unreadable complete `attempted` line mid-file → that receipt unknown and not restored; malformed
  bytes → every restorable receipt unknown;
- a spoken action restored after the catalogue text changed delivers the **pinned** words;
- `GET /api/actions/receipts` shows recovery conclusions and `unknownWithoutHold`;
- material files are gone after delivery, withdrawal and every unknown.

Plus unit tests in `fleet-queue.test.ts` / `fleet-drain.test.ts` for each transition's record.
**Fixture ids**: mint fresh uuids; `tests/fixture-ids.test.ts` fails on any uuid in two test files.

## Constraints

- No keystroke ever reaches a real pane: every transport is injected.
- Do not touch `send-coordinator.ts`, `steer.ts`, `routes-steer.ts`, `routes-broadcast.ts` (beyond
  nothing — the queued half goes through the queue), `tools/overseer/`, or `tools/fleet/web/`.
- Never log or store message text outside a material file.
- Do not run git commands that change history or the index; do not commit. List every file you
  changed or created.

## Gates you must run before answering

`npx vitest run tests/fleet-queue.test.ts tests/fleet-drain.test.ts tests/fleet-actions-route.test.ts
tests/fleet-refresh.test.ts tests/fleet-quarantine.test.ts tests/fleet-hold-ledger.test.ts
tests/fleet-hold-restart.test.ts tests/fleet-receipt-journal.test.ts tests/fleet-action-stores.test.ts
tests/fleet-receipt-restart.test.ts tests/fleet-send-composition.test.ts tests/fleet-web.test.tsx
tests/fleet-compile-guards.test.ts tests/fleet-imports.test.ts` and `node --import tsx
scripts/typecheck.ts` (say so if tsx IPC is refused; I will run it). Paste both tails.
