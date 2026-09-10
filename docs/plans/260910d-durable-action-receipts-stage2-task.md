# Task: Stage 2 of plan 260910d — request ids and replay, on the steer and enqueue routes

You are an Opus subagent implementing one stage. Work **in this worktree only**:
/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts (TypeScript + ESM, `tsx`,
vitest). Do not commit, do not run git commands that change the index or history, do not touch any
other worktree or the primary checkout. Do not restart, kill or contact the running fleet dashboard
(port 8787) or any tmux session — every transport in tests is injected; there are ~36 live agent
sessions on this box doing other people's work.

**Read first, in order:** `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md`
(authoritative — § The fingerprint, § The actor, § Write-ahead, § Retention, § The crash points), both
plan reviews, the Stage 1a and 1b reviews, and the Stage 1 code: `tools/fleet/receipt-journal.ts`,
`tools/fleet/action-stores.ts`, `tools/fleet/queue.ts`, `tools/fleet/drain.ts`,
`tests/fleet-receipt-restart.test.ts` (its frozen-disk harness is the one to reuse — extract it to a
shared helper under `tests/` if you need it in a second file). Then `tools/fleet/routes-steer.ts`
(`run`, `parseMessageBody`, `parseAnswerBody`) and `tools/fleet/routes-actions.ts` (`sessionRoute`,
`enqueue`, `parseSessionBody`).

## What to build

### 1. The request id, the fingerprint and the lookup — before anything about executing now

In `/api/steer/message`, `/api/steer/answer` and `/api/actions/session` (every mode), right after the
body is JSON-parsed and **before** `parseMessageBody`/`parseAnswerBody`/`parseSessionBody` (they
resolve the current catalogue and apply the current build's speaker rule — plan § The fingerprint,
Sol F16):

- If the object has a `requestId` field: `parseRequestId` it. **Present but malformed → `400
  bad-request-id`, never downgraded to unkeyed.** Absent → the request is unkeyed and everything below
  is skipped; the route behaves exactly as today plus Stage 1's receipts.
- The fingerprint is sha256 over the **canonical JSON (keys sorted, recursively) of the raw object with
  `requestId` removed** — the client's fields as sent, nothing the server derived. Put the canonicaliser
  and hash in one small exported function with its own tests (key order, nesting, arrays keep order,
  `-0`/`0`, unicode).
- `receipts.byRequestId(id)`: found with the same fingerprint → **replay**: `200 {ok: true, op:
  "receipt", replay: true, receipt: <ReceiptSummary>}` and **nothing else happens** — not the parse,
  not the limiter, not the queue, not the coordinator. Found with a different fingerprint → `409
  request-id-conflict`. Not found and `admitUnknownRequestId` false → `409 request-id-expired` (the
  sentence says it may already have been acted on and cannot be checked). Not found and fresh → carry
  on to the existing parse and validation.

### 2. Keyed acceptance fails closed

- A keyed `accept` that does not land → `503 receipt-unavailable`, and **no effect**. For the enqueue
  route that means the queue's `push` must thread `requestId` and `fingerprint` through to `accept`
  and refuse (a new `EnqueueRefusalRule`) rather than enqueue in memory; for the steer routes, see 3.
- A keyed request's `accept` with a `requestId` the journal already has (a race is impossible — the
  process is single-threaded and the lookup and the accept are synchronous with no `await` between —
  but the journal refuses it) is a replay, not an error.

### 3. Receipts for direct steer and answer (`routes-steer.ts`)

`SteerDeps` gains `receipts: ReceiptJournal` (`realSteerDeps` → `sharedReceiptJournal()`; tests inject
`memoryReceiptJournal`). After the limiter check and `record`, and **before** the coordinator:

- `accept` with op `steer-message` / `steer-answer` (extend `ReceiptOp` and its parser), origin
  `direct-steer` (extend `ReceiptOrigin`), actor `{client-claimed, speaker}` for a message and
  `{unattributed-http, null}` for an answer (plan § The actor), `speaker` null for an answer, target
  from the parsed `SteerTarget` with `tmuxGeneration` = the book's `knownGeneration() ??
  receipts.lastGeneration()`, `what` exactly the existing description (never text), `queue: null`,
  **no material** (a direct send is never restored).
- Then `attempted`. For a durably accepted receipt, **`{landed: false}` → no send**: respond `503
  receipt-unavailable` and conclude the receipt `not-sent` with a new reason `attempt-not-recorded`
  (fail-open write, memory at least).
- Then the coordinator, and the outcome from its answer: `held` → `not-sent`/`session-held`;
  `answered` ok → `keys-submitted`/`transport-ok`; `answered` with `unsent` → `not-sent`/
  `transport-refused-unsent` (code = the refusal code); `answered` with a hold → `outcome-unknown` with
  the hold's reading (`partial`/`unknown`/`none-contradicted`); `threw` → `outcome-unknown`/`threw`.
  The refusals that happen before the limiter (answering disabled, bad parse) create no receipt.
- Every response of a keyed request that reached `accept` carries `receiptId`. Additive fields only;
  **if the web client stops compiling, stop and report — do not edit `tools/fleet/web/`**.

### 4. Recovery of a direct send (`receipt-journal.ts`)

A receipt with `queue: null` found at `accepted` with no `attempted`, whose `accepted` was on disk, is
**proven not attempted** (keyed and unkeyed alike: `attempted` is fail-closed for durable receipts) —
conclude `not-sent`/`interrupted-before-attempt` (new reason). At `attempted` it is already
`outcome-unknown`/`interrupted` from Stage 1. Neither is ever restored.

### 5. The replay summary

`ReceiptSummary` (from Stage 1b, in `wire.ts`) is what a replay returns. It must say whether the
receipt is still pending (non-terminal), and never contain message text.

## Tests — each red first; say in your answer that you saw it red

- Fingerprint canonicalisation unit tests.
- For each of the three routes: same id + same body twice → one effect, two identical receipts (count
  transport calls / queue items); same id + different body → 409 and no effect; malformed id → 400;
  an old id not in the journal → 409 expired; a replay is answered **before** the limiter (drive the
  limiter to refuse and show the replay still returns 200) and **after a catalogue change** (the
  action id no longer resolves, the replay still returns the receipt).
- Keyed accept that cannot land → 503 and no effect (steer: no transport call; enqueue: no item).
- Durably accepted direct send whose `attempted` cannot land → 503, no transport call, receipt
  `not-sent`/`attempt-not-recorded`.
- **Crash tests with the frozen-disk harness**, for a direct message: every row of the plan's crash
  table that applies to a direct send, and **a duplicate HTTP request after a restart** — the same
  envelope posted to a fresh composition over the same directory returns the stored receipt and makes
  **zero** transport calls, for each of: outcome landed before the response; frozen after `attempted`
  (replay says `outcome-unknown`); frozen after `accepted` (replay says `not-sent`/
  `interrupted-before-attempt`).
- **Fixture ids**: mint fresh uuids; `tests/fixture-ids.test.ts` fails on a uuid in two test files.

## Constraints

- `tools/fleet/wire.ts`: additive types only. Do not touch `send-coordinator.ts`, `steer.ts`,
  `server.ts`, `routes-broadcast.ts`, `tools/overseer/`, or `tools/fleet/web/`.
- No `Date.now()` in new logic; use the injected clocks.
- Never log or store message text.

## Gates you must run before answering

`npx vitest run tests/fleet-steer-route.test.ts tests/fleet-actions-route.test.ts
tests/fleet-queue.test.ts tests/fleet-drain.test.ts tests/fleet-receipt-journal.test.ts
tests/fleet-receipt-restart.test.ts tests/fleet-action-stores.test.ts tests/fleet-hold-restart.test.ts
tests/fleet-send-composition.test.ts tests/fleet-compile-guards.test.ts tests/fleet-imports.test.ts
tests/fleet-web.test.tsx tests/fixture-ids.test.ts <your new test files>` and `npm run typecheck`.
**Read each command's exit code directly** — do not pipe it through `tail` and report the tail's
status. Report: what you built, every file you changed or created, which tests you saw red first, and
the exact exit codes. Keep the report under 700 words; no file dumps.
