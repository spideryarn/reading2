# Task: Stage 1a of plan 260910d — the stores (no wiring into the queue, drain or routes)

Repo: this worktree (/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts). TypeScript
+ ESM, `tsx`, vitest. **Read `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md`
in full first** — it is the spec, and its § The design is authoritative where this brief is shorter.
Also read both plan reviews (`…-plan-review-sol.md`, `…-plan-review2-sol.md`) and the plan's review
table. This task is Stage 1a. **Nothing is wired into `queue.ts`, `drain.ts` or the route files in
this task**; that is Stage 1b.

## What to build

### 1. `tools/fleet/journal-file.ts` — the physical JSONL core, extracted from `hold-ledger.ts`

**Bytes, locking, repair and checkpoint replacement only** — no parsing policy, no folds, no
retention. Generic over a record type through caller-supplied `parse(line) => R | null` and
`serialise(record) => string`:

- absolute-dir check; `mkdirSync(dir, {recursive: true, mode: 0o700})`;
- **the lock can be taken by the core OR handed in** (`HeldLock` from `tools/overseer/lock.ts`), so two
  files can be opened under one claim; `takeLock` before `truncateToLastLine` (keep that ordering and
  its comment); `stillOurs` around the repair and before every append; a second opener reads but does
  not write (`lockedOutBy`);
- read every line: parsed records, plus the **raw text of every non-empty line that did not parse**
  (the receipt store needs it — see below; the hold ledger only counts them);
- `append(record): boolean` — open `a` 0600, injected `writeLine` (default `writeAll`), `onTrouble`
  once per new trouble, `failure` cleared on success; **true only if the bytes landed**;
- `replace(records)` — the atomic rewrite through `writeAtomically`, counted; when to call it is the
  store's decision;
- `status()` (dir, file, lockedOutBy, failure, unreadableLines, repaired, compactions), idempotent
  `close()` that releases the lock **only if the core took it**.

Per-store sentences (the "Holds opened here will not survive a restart." suffix, the lock-refusal
suffix) are parameters. Keep the long WHY comments with the code they justify — move them, don't
delete them.

`hold-ledger.ts` is reimplemented over it with **every export's name, signature and behaviour
unchanged** (its size-triggered compaction policy stays in `hold-ledger.ts`), plus one additive
option: open under a lock handed in. **`tests/fleet-hold-ledger.test.ts`, `tests/fleet-hold-restart.test.ts`
and `tests/fleet-hold-wiring.test.ts` must pass with no edits.** That is the proof the extraction
preserves behaviour. If one of them needs an edit, stop and say why.

### 2. `tools/fleet/receipt-journal.ts` — the receipt store, over the core

Files, all in the directory `holdLedgerDir()` resolves (import it): `receipts.jsonl`,
`receipts.unreadable.jsonl`, and `material/<receiptId>.json`. No lock file of its own — it opens under
the lock handed to it (see 3).

**Records** (all `schema: 1`, strict parse), as the plan's § Records lists them: `accepted`
(receiptId, requestId: string|null, fingerprint: string|null, op, origin, actor {kind:
"client-claimed"|"unattributed-http"|"system", id: string|null}, speaker: Speaker | null (nullable,
never invented), target {sessionId, paneId, claudeSessionId, tmuxGeneration}, what (bounded
description, never message text), serverInstanceId, queue {itemId, enqueuedAt} | null), `attempted`, `returned` (code), `outcome` (state + reason as a discriminated
union so a wrong pairing does not compile; code; bounded why), `reconciled` (disposition, actor),
`withdrawn` (**receiptIds: string[]**, reason cancelled|cleared, actor), and `generation` (tmux server
pid observed). `op` for now: `"queued-message" | "queued-action"`; `origin`: `"enqueue" |
"broadcast"`. Leave the unions open to Stages 2–3 but do not add their members.

Outcome states and their reasons — exactly the plan's diagram:
- `keys-submitted`: `transport-ok`
- `not-sent`: `transport-refused-unsent`, `session-held`, `undeliverable`, `lost-at-restart`,
  `tmux-generation-changed`, `tmux-generation-unproven`
- `outcome-unknown`: `partial`, `unknown`, `none-contradicted`, `threw`, `interrupted`,
  `lease-abandoned`, `recovery-blocked`
- (`withdrawn` is its own record; `completed`/`plan-stopped` are Stage 3 — do not add them.)
- `reconciled` dispositions: `lease-abandoned` only (Stage 4 adds its own). **A receipt never
  installs, extends or ends a hold** — the plan's § Restoring, the barrier bullet.

**The transition rule** is enforced at write (refused, trouble recorded, `append` not called) and at
read (skipped, counted in `status().illegalTransitions`), per the plan's diagram.

**Material**: `putMaterial(receiptId, payload)` writes `material/<receiptId>.json` atomically, 0600,
**before** the caller appends `accepted`; the payload is the exact sendable thing — `{kind:"message";
text; speaker}` or `{kind:"action"; action: SpokenAction; speaker}` (import `SpokenAction`/`Speaker`
types from `actions.ts`/`wire.ts`). **Material is live at `accepted`, `attempted` and `returned`
only.** Any `outcome` (including `outcome-unknown`) or `withdrawn` ends it: after that record lands,
the material file **and any temporary sibling `writeAtomically` may have left** are deleted. A failed
deletion is recorded on `status()` (`materialDeletionPending: receiptId[]`), retried at startup and at
each compaction, and `get(receiptId)` reports `materialDeletionPending: true` for it rather than
claiming the bytes are gone. Material is never written into the journal.

**Store API** (names are suggestions):

```ts
openReceiptJournal(dir, { lock, now, serverInstanceId, writeLine?, onTrouble? }) → {kind:"open"; journal} | {kind:"refused"; why}
memoryReceiptJournal({ now, serverInstanceId }) → ReceiptJournal   // no files; durable() false; status says "never opened"
ReceiptJournal = {
  accept(input): {ok: true; receiptId; durable: boolean} | {ok: false; why}   // mints `${serverInstanceId}-r${n}`; capacity refusals
  attempted(receiptId): { landed: boolean }
  returned(receiptId, code): boolean
  outcome(receiptId, arm): boolean
  withdrawn(receiptIds, reason, actor): boolean          // one record, all-or-nothing
  reconcile(receiptId, disposition, actor): boolean
  noteGeneration(pid): void                             // writes a `generation` record when it changes
  lastGeneration(): number | null
  get(receiptId); byRequestId(requestId); recent(limit); forSession(sessionId); nonTerminal()
  restorable(): RestorableItem[]      // queued work at accepted/returned, with pinned material and generation
  unknownKeystrokeReceipts(): ReceiptState[]  // for the endpoint's `unknown-without-hold` flag; never used to hold anything
  durable(): boolean; acceptedDurably(receiptId): boolean
  recovery(): RecoverySummary; status(): ReceiptJournalStatus; close(): void
}
```

`now` and `serverInstanceId` are injected; no `Date.now()` in the module. **In-memory state changes
only when the bytes landed**, except in a memory-only or locked-out journal, where memory is the only
record and is kept (so this run's receipts can still be read) while `durable()` is false.

**Recovery at open**, only when this opener holds the lock (a locked-out reader concludes nothing on
disk and reports what it would conclude), per the plan's § Restoring:
- last state `attempted` → `outcome-unknown`/`interrupted`;
- **unreadable lines, envelope first** (the plan's § Restoring): parse `schema`/`kind`/`receiptId`
  separately from the domain fields. An invalid line whose envelope is trustworthily `kind:
  "generation"` sets `recovery().generationUnproven = true` and nothing else. An invalid action record
  with a string `receiptId` → that receipt `outcome-unknown`/`recovery-blocked` (reported as orphan
  evidence, with no invented target, if no valid `accepted` precedes it). Malformed bytes, or an action
  envelope with no attributable id → **every** restorable queued receipt `outcome-unknown`/
  `recovery-blocked`, and `recovery().blocked` true with the reason;
- every unreadable line's raw text appended to `receipts.unreadable.jsonl` **before** any rewrite;
- queued work at accepted/returned with no material file → `not-sent`/`lost-at-restart`;
- material files, final or temporary, that belong to no receipt at `accepted`/`attempted`/`returned`
  deleted;
- **id reservation**: every queue item id and receipt id in the retained records is reserved;
  `accept` mints above any retained suffix carrying this run's token and skips any reserved id;
  `reservedQueueItemIds()` is exported for the queue to do the same; two retained records claiming one
  id for different receipts → both `outcome-unknown`/`recovery-blocked`;
- then one compaction.

**Retention and capacity**, per the plan's § Retention: keyed receipts retained 7 days from
acceptance; **5,000 retained keyed receipts is an admission cap** (`accept` with a `requestId` refused
at capacity, never an eviction); unkeyed terminal receipts dropped oldest-first beyond that count;
at most 1,000 non-terminal, never evicted. Compaction at open, when the oldest terminal receipt
passes retention (checked on append), and when the file passes max(1 MiB, 2 × its size after the last
compaction). Compaction keeps the latest `generation` record.

**`parseRequestId(v, now)`** (nothing calls it until Stage 2): format `rq-<ms since epoch base36>-<16
to 40 chars [a-z0-9]>`; returns `ok` with the mint time, or `bad-format`. And
`admitUnknownRequestId(mintedAt, now)`: true only within ±`REQUEST_ID_SKEW_MS` (1 hour). Export
`RETENTION_MS` (7 days) and `REQUEST_ID_SKEW_MS`, with the plan's arithmetic for why a forgotten id
is always refused written beside them.

### 3. `tools/fleet/action-stores.ts` — `openFleetActionStores()`

Resolves `holdLedgerDir()`, takes `writer.lock` **once**, opens the hold ledger and the receipt
journal under that one lock, builds the shared quarantine book over the ledger (exactly what
`openSharedQuarantine()` does today: rehydrate, the same startup lines), and returns `{book, ledger,
receipts, rehydrated, recovery, lines}`. A second dashboard that loses the lock opens both read-only.
A shared accessor `sharedReceiptJournal()` returns the opened journal, or a memory-only one if the
stores were never opened — mirroring `sharedQuarantineBook()` — and `openFleetActionStores()` throws
if the shared journal or book was handed out before it ran, exactly as `openSharedQuarantine()` throws
today. `openSharedQuarantine()` keeps its signature and behaviour (other callers and tests use it);
implement it over the same code rather than duplicating it. A test-only reset.

**Do not edit `server.ts` or `tests/fleet-hold-wiring.test.ts` in this task** — that swap is Stage 1b.

## Tests — write each red first, and say in your answer that you saw it red

`tests/fleet-receipt-journal.test.ts` and `tests/fleet-action-stores.test.ts`, covering: round-trip
of every record kind; strict refusal of malformed lines; each illegal transition refused at write and
counted at read; material written 0600 before accepted and unlinked at every terminal path
(outcome, withdrawn) and at recovery for orphans; recovery: `interrupted` for a dangling `attempted`,
`recovery-blocked` for an attributable unreadable line, the blanket rule for an unattributable one,
`lost-at-restart`, raw unreadable lines preserved in the side file before compaction, a locked-out
second opener writing nothing; retention: keyed receipts kept for 7 days and dropped after, the 5,000
admission cap refusing rather than evicting, unkeyed terminal receipts evicted past the count,
non-terminal never evicted and the 1,000 cap; `withdrawn` for several receipts in one record; a write
failure (injected `writeLine`) recorded not thrown, `acceptedDurably` false, and memory unchanged;
`parseRequestId`/`admitUnknownRequestId` at every boundary; `openFleetActionStores` taking one lock
for both files, a second opener read-only for both, and the throw when the shared book was handed out
first.

**Fixture ids**: `tests/fixture-ids.test.ts` fails if any uuid appears in two test files. Mint fresh
ones; do not copy one from another test file.

## Constraints

- No `Date.now()` in the stores; inject `now`.
- Never log or store message text anywhere but a material file.
- Do not touch `send-coordinator.ts`, `steer.ts`, `server.ts`, `queue.ts`, `drain.ts`, the route
  files, `tools/overseer/`, or anything under `tools/fleet/web/`. `tools/fleet/wire.ts`: nothing needed
  in this task.
- Do not run git commands that change history or the index; do not commit. List every file you
  changed or created at the end of your answer.

## Gates you must run before answering

`npx vitest run tests/fleet-hold-ledger.test.ts tests/fleet-hold-restart.test.ts
tests/fleet-hold-wiring.test.ts tests/fleet-quarantine.test.ts tests/fleet-receipt-journal.test.ts
tests/fleet-action-stores.test.ts` and `node --import tsx scripts/typecheck.ts` (if tsx IPC is
refused in your sandbox, say so; I will run it). Paste the tail of both into your answer.
