# Task: Stage 3 of plan 260910d — enacted plans and the broadcast

You are an Opus subagent implementing one stage. Work **in this worktree only**:
/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts (TypeScript + ESM, `tsx`,
vitest). Do not commit, do not run git commands that change the index or history, do not touch any
other worktree or the primary checkout. Do not restart, kill or contact the running fleet dashboard
(port 8787) or any tmux session, and **never run a real kill or a real `git worktree remove`**: every
`ActionIo`, transport and clock in tests is injected. `FLEET_ACT_ENABLED` stays off on the box; tests
turn acting on through `actEnabled: () => true` on a fake composition.

**Read first, in order:** the plan `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md`
(§ The fingerprint, § The actor, § The receipt's states, § Write-ahead, § The crash points — all
authoritative), the Stage 1 and Stage 2 reviews, and the code Stages 1–2 built:
`tools/fleet/receipt-journal.ts`, `tools/fleet/action-stores.ts`, the request-id lookup and replay in
`tools/fleet/routes-steer.ts` and `tools/fleet/routes-actions.ts`, and
`tests/fleet-receipt-restart.test.ts` with its frozen-disk harness. Then the paths this stage wraps:
`runPlan` and `sessionRoute`'s run branch, `boxRoute`, `killRoute`, `broadcastRoute` in
`routes-actions.ts`, and `fanOut` and `run` in `tools/fleet/routes-broadcast.ts`.

## What to build

### 1. Box-scoped receipts and parent/child links (`receipt-journal.ts`, `wire.ts`)

- New ops: `enacted-session` (remove-worktree, kill-session), `enacted-box` (the box kills),
  `broadcast` (a parent: one per broadcast request, free-text or ease-off), `broadcast-recipient` (a
  direct send to one recipient of a broadcast). Queued recipients keep `queued-message`, with a
  parent link.
- `accepted.target` becomes `ReceiptTarget | null`, **null exactly for box-scoped ops** (`enacted-box`,
  `broadcast`), enforced in the parser and, where you can, in the type. Never a sentinel session id.
- `accepted.parentReceiptId: string | null` — set on every child of a broadcast, null otherwise.
- A `progress` record: `{receiptId, at, step: number, status, verdict}` — `status` from `judgeStep`,
  `verdict` bounded, **never a word of message text**. Legal only after `attempted` and before the
  outcome, at most once per step index, in order.
- Outcomes `completed` (every gate passed) and `plan-stopped` (a gate failed at step k — `code` names
  k), as the plan's state diagram says; `outcome-unknown`/`interrupted` recovered for a crash mid-plan.
- `ReceiptSummary` gains `stepsCompleted: number | null`, `parentReceiptId`, and a nullable target.
  Additive where the client reads it; **if `tools/fleet/web/` stops compiling, stop and report**.

### 2. Enacted plans (`routes-actions.ts`)

For `sessionRoute` in run mode and `killRoute` in run mode:

- The request-id lookup and replay from Stage 2 applies (a replay after restart returns the receipt
  even though the preview has gone — plan § The fingerprint, Sol F16).
- `accept` **synchronously, before the first `await`** — for `boxRoute` that means at the existing
  one-way door where the preview is marked `claimed`; for `sessionRoute`, right after the limiter.
  Keyed accept fails closed (`503`), as in Stage 2.
- `attempted` (fail-closed for a durable receipt) **before `runPlan`**. Give `runPlan` an optional
  `onStepDone(index, outcome)` and write a `progress` record from it — fail-open: a lost progress line
  only makes a crash report fewer completed steps, which is conservative.
- Outcome from the run: `completed`, `plan-stopped`, or `outcome-unknown`/`threw` if `runPlan` throws.
  A kill's `KillReport` observations go into the outcome's bounded `why` as counts.
- The response of a keyed run carries `receiptId`.

### 3. Broadcasts (`routes-broadcast.ts` and `broadcastRoute`)

- One parent receipt per run, carrying the `requestId`; `target: null`; accepted before the queued half
  and the fan-out, attempted before the first recipient.
- Each **direct** recipient gets a child `broadcast-recipient` receipt: accepted, attempted, and its
  outcome from the coordinator exactly as Stage 2 records a direct steer (`held` → `not-sent`/
  `session-held`; ok → `keys-submitted`; unsent → `not-sent`; ambiguous → `outcome-unknown`). A
  recipient never reached before the deadline gets `not-sent`/`not-reached` (new reason) — it was
  never attempted.
- Each **queued** recipient's item is accepted with `parentReceiptId`.
- **Stage 1b review F36**: `EnqueueForBroadcast` / `enqueueSharedMessage` must carry the queue's
  `durable` bit through; a recipient whose queued receipt is not durable is reported so in the
  recipient's outcome and the response (additive field), never as a plain *queued*.
- The parent's outcome: `completed` when every recipient's child reached an outcome, `outcome-unknown`
  when the process died mid fan-out (recovered as `interrupted`), and its `why` counts the children by
  state.
- Replay of a broadcast returns the parent receipt and its children's summaries; it sends nothing.

## Tests — each red first; say which you saw red

- Enacted run: accepted and attempted before `runPlan`; one progress record per completed step; the
  outcome for complete, stopped-at-k and thrown runs.
- **Crash tests with the frozen-disk harness**, on fake `ActionIo`: a crash after step 1 of a
  two-step `remove-worktree` recovers as `outcome-unknown`/`interrupted` with `stepsCompleted: 1`; and
  **a duplicate HTTP request after a restart** for a confirmed kill and for a worktree removal returns
  the stored receipt and makes **zero** `runStep` calls — including when the preview it named no
  longer exists.
- Broadcast: parent plus a child per direct recipient; `not-reached` children past the deadline; a
  crash mid fan-out recovers the parent as unknown and does not re-send any recipient; replay after a
  restart sends nothing; F36's non-durable queued recipient is reported as such.
- Keyed run whose accept cannot land → `503` and no effect; durable run whose `attempted` cannot land →
  no `runPlan` call.
- **Fixture ids**: mint fresh uuids.

## Constraints

- Additive types only in `wire.ts`. Do not touch `send-coordinator.ts`, `steer.ts`, `server.ts`,
  `tools/overseer/` or `tools/fleet/web/`.
- No `Date.now()` in new logic; injected clocks.
- Never log or store message text; a step's argv may name pids and paths, which are not message text,
  but keep progress records to step index, status and a bounded verdict.

## Gates you must run before answering

`npx vitest run tests/fleet-actions-route.test.ts tests/fleet-actions.test.ts
tests/fleet-broadcast-route.test.ts tests/fleet-broadcast-card.test.tsx tests/fleet-steer-route.test.ts
tests/fleet-queue.test.ts tests/fleet-drain.test.ts tests/fleet-receipt-journal.test.ts
tests/fleet-receipt-restart.test.ts tests/fleet-receipt-guards.test.ts tests/fleet-action-stores.test.ts
tests/fleet-hold-restart.test.ts tests/fleet-send-composition.test.ts tests/fleet-compile-guards.test.ts
tests/fleet-imports.test.ts tests/fleet-web.test.tsx tests/fixture-ids.test.ts <your new files>` and
`npm run typecheck`, each exit code read directly. Report what you built, every file you changed or
created, which tests you saw red, any decision the brief did not settle, and the exit codes. Under 700
words.
