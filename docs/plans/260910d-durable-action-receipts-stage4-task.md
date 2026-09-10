# Task: Stage 4 of plan 260910d — reading receipts, and the clients keeping envelopes

You are an Opus subagent implementing one stage. Work **in this worktree only**:
/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts (TypeScript + ESM, React, `tsx`,
vitest). Do not commit, do not run git commands that change the index or history, do not touch any
other worktree or the primary checkout. Do not restart, kill or contact the running fleet dashboard
(port 8787) or any tmux session; every `fetch`, transport and clock in tests is injected.

**Read first, in order:** the plan `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md`
— § The fingerprint, § Stage 4 and the **"Agreed with `session-continuity`"** block under it, which is
authoritative for the drafts seam — then `docs/postmortems/260910c-a-mutable-text-hook-erased-the-submission-it-produced.md`
and `tests/fleet-drafts.test.tsx`. Then the server side you are the client of: `tools/fleet/request-key.ts`,
the replay arms in `tools/fleet/routes-steer.ts`, `routes-actions.ts` and `routes-broadcast.ts`
(Stages 2 and 3), and `GET /api/actions/receipts` with `ReceiptSummary` in `tools/fleet/wire.ts`.

## Authorised files (the Overseer, 2026-09-10) — and nothing else under `tools/fleet/web/`

`tools/fleet/web/src/actions-client.ts`, `steer-client.ts`, `broadcast-client.ts`; the **composer**
in `SessionDetail.tsx`, and `MessageOverseerCard.tsx`, `BroadcastCard.tsx`; a new `ReceiptList.tsx`
mounted in `OverseerPanel.tsx`. **Not** `drafts.ts`, `useActions.ts`, `SessionsPanel.tsx`,
`HealthPanel.tsx`, the Usage Limits tab, or any other web file. If one is needed, stop and report.

## What to build

### 1. The envelope (the three clients)

- A small shared helper (in whichever client file fits, or a new `request-envelope.ts` beside them —
  that new file is allowed) that mints a `requestId` in the server's format — `rq-<Date.now() in base
  36>-<24 chars [a-z0-9]>` from `crypto.getRandomValues` — and builds an **immutable** `{requestId,
  body}` envelope. The body sent is the envelope's body with `requestId` added, and a retry sends
  **exactly the same bytes**: build the JSON once and keep it.
- Every write the server keys — steer message and answer, session enqueue (and session and box runs,
  and the broadcast run, as Stage 3 made them keyed) — goes out as an envelope.
- **An envelope belongs to one route.** The route is part of the server's fingerprint, so if any code
  path falls back from one route to another (for example a direct steer that fails and is then
  queued), the fallback is a **new intention with a new `requestId`** — reusing the envelope would be
  answered `409 request-id-conflict`. Check every such path.
- The outcome union each API returns gains the arms the server can now answer: **`replay`** (`200,
  op: "receipt", replay: true` — a definitive answer carrying a `ReceiptSummary`),
  **`request-id-conflict`** and **`request-id-expired`** (409, definitive, nothing done),
  **`receipt-unavailable`** (503, definitive, nothing done), and **`not-confirmed`** — the request left
  and no definitive answer came back (a network error, an abort, a timeout, or a response that is not
  one of the server's shapes). **Only `not-confirmed` keeps the envelope for a retry.** Parse
  defensively: a shape you cannot read is `not-confirmed`, never success.

### 2. The composers and the ticket seam (`SessionDetail.tsx` composer, `MessageOverseerCard.tsx`, `BroadcastCard.tsx`)

Exactly as the plan's agreed block says, restated because it is the part most easily got wrong:

- The ticket (`DraftSubmission` from `useDraft`) is taken **at Send**, and the envelope **carries it**.
- `not-confirmed` → **never** `accept`. The text stays in the box and in sessionStorage, and the
  composer shows *"not confirmed — the dashboard may or may not have acted on it"* with an explicit
  **Check** button that resends **the same envelope**, carrying **the original ticket**. Never a silent
  retry; never a new id; never a new ticket.
- A replay → definitive success → `accept(originalTicket)`. The ordinary success arm is unchanged.
- 409 (conflict, expired) and 503 → definitive refusal → keep the draft, drop the envelope, show the
  server's sentence. **No automatic resend without an id** on a 503 — that is a question for Greg, not
  a default.
- Any other existing arm behaves exactly as today.
- **A pending envelope is memory-only in this stage**: a page reload keeps the draft's text (drafts.ts)
  but loses the envelope, so the next Send is a new intention with a new id. Say so in a comment where
  the envelope lives, with the 260910c F31 limit beside it, and test that the reload case never reuses
  a ticket.

### 3. `ReceiptList.tsx`, mounted in `OverseerPanel.tsx`

- Self-contained; polls `GET /api/actions/receipts` through `singleFlightReader` (one request in flight,
  a deadline, abort on unmount, the last good answer kept on a failed read).
- For each recent receipt, **what is proven and what is unknown, in words built from the fields, never
  one label**: accepted at; attempted at; *keys submitted* (never "delivered" or "read"); steps
  completed; withdrawn; not sent and why; **outcome unknown** and why; reconciled by whom. Show the
  journal's status when it is not durable, and the `unknownWithoutHold` sessions prominently.
- Mount it on the Overseer tab near the two cards; not in the Sessions detail pane (it remounts on a
  change of execution identity).
- Extend `ReceiptSummary` if the list needs a field; do not add a parallel `ReceiptView` type.

### 4. Reconciliation of an unknown enacted plan (server, `routes-actions.ts` and `receipt-journal.ts`)

`POST /api/actions/receipts/reconcile {receiptId, disposition: "operator-confirmed" |
"abandoned-unknown"}`, only for an `outcome-unknown` receipt of an enacted op (`enacted-session`,
`enacted-box`); origin-checked like every other write; records a `reconciled` with actor
`client-claimed` (`greg`). **It never changes the outcome** — an unknown stays unknown, with a person's
statement beside it. Idempotent for the same disposition, refused for a different one. `ReceiptList`
offers the two buttons on such receipts.

## Tests — each red first; say which you saw red

- Client: a lost response followed by **Check** resends the same id and byte-identical body; replay is
  success; 409 and 503 are definitive and drop the envelope; an unreadable 200 is `not-confirmed`.
- Composers, in the existing web test files' style: `not-confirmed` never calls `accept` and keeps the
  text; **Check** carries the original ticket (typing after Send, then Check → replay, keeps the new
  typing — the 260910c case); a replay accepts; 409 keeps the draft; a reload drops the envelope.
- **End to end, with a restart between**: drive the real `makeSteerRoutes` over a durable journal in a
  temp dir with a fake transport, let the first response be "lost" (the client sees a network error
  after the server acted), rebuild the routes over the same directory, press Check, and assert one
  transport call in total and a replay arm on the client.
- `ReceiptList` renders each state's words, the non-durable status and `unknownWithoutHold`; the
  reconcile route and its two buttons.
- **Fixture ids**: mint fresh uuids.

## Gates you must run before answering

`npx vitest run tests/fleet-web.test.tsx tests/fleet-drafts.test.tsx tests/fleet-broadcast-card.test.tsx
tests/fleet-overseer-message.test.tsx tests/fleet-steer-route.test.ts tests/fleet-actions-route.test.ts
tests/fleet-request-replay.test.ts tests/fleet-receipt-journal.test.ts tests/fleet-compile-guards.test.ts
tests/fleet-imports.test.ts tests/fixture-ids.test.ts <your new files>` and `npm run typecheck`, each
exit code read directly. Report what you built, every file you changed or created, which tests you saw
red, any decision the brief did not settle, and the exit codes. Under 700 words.
