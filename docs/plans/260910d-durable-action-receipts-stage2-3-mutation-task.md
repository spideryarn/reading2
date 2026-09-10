# Task: mutation-test Stages 2 and 3 of plan 260910d

Stage 1 was mutation-tested (22 mutations, 17 killed, four real holes closed by
`tests/fleet-receipt-guards.test.ts`). This is the same for Stages 2 and 3: does the suite NOTICE
when one of their guarantees is broken? A test that stays green under a mutation that breaks a
guarantee is a finding. You do not fix code; you report.

## Where to work — your own worktree

You have an isolated worktree. Bring the branch in with `git merge --no-edit
worktree-durable-action-receipts` (merge only). If `npm run worktree:setup` tries to merge
`origin/dev` and conflicts, `git merge --abort` and run `npm ci --prefer-offline --no-audit --no-fund`
instead. **Never touch /home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts** — another
agent is editing it. Never commit or push. Undo each mutation by editing the text back; confirm your
`git diff` is empty at the end.

## The gate for each mutation

`npx vitest run tests/fleet-request-key.test.ts tests/fleet-request-replay.test.ts
tests/fleet-direct-steer-restart.test.ts tests/fleet-holds-durable.test.ts tests/fleet-steer-route.test.ts
tests/fleet-actions-route.test.ts tests/fleet-enacted-receipts.test.ts tests/fleet-broadcast-receipts.test.ts
tests/fleet-broadcast-route.test.ts tests/fleet-receipt-journal.test.ts tests/fleet-receipt-restart.test.ts`
— killed (a test red) or survived; for a kill, which test. Read the exit code directly.

## The mutations — one at a time, each reverted before the next

`tools/fleet/request-key.ts`
1. `requestFingerprint` hashes the body only (drop the route).
2. `readRequestKey`: treat a malformed `requestId` as unkeyed instead of `bad`.
3. `lookupRequest`: skip the `admitUnknownRequestId` freshness check.

`tools/fleet/routes-steer.ts`
4. Move the request-id lookup to after the rate limiter's check.
5. Ignore `attempted(...).landed` — send even when it did not land.
6. On a keyed accept failure, send anyway (fall back to unkeyed).

`tools/fleet/receipt-journal.ts`
7. Recovery: conclude a direct send found at `accepted` as `interrupted-before-attempt` even when the
   journal holds malformed bytes.
8. Parser: accept a `broadcast-recipient` with `parentReceiptId: null` (revert F42).
9. `broadcastParentOutcome`: always `completed` (revert F41).

`tools/fleet/quarantine.ts` / `journal-file.ts`
10. `durable()`: drop the check that every open hold has a live ledger record (revert half of F39).
11. `status()`: drop the lock re-check (revert the other half of F39).

`tools/fleet/routes-actions.ts`
12. Box route: do the request-id lookup after `validatePreview` instead of before the parse.
13. Enacted run: skip `attemptOrRefuse` (run the plan with no durable `attempted`).
14. Enacted run: make the `onStepDone` progress callback a no-op.
15. `refuseAfterDoor`: do not settle the receipt (leave it at `accepted`).

`tools/fleet/routes-broadcast.ts`
16. Mark the parent attempted after the queued half instead of before it.
17. Put `attempt.error.message` back into the thrown-transport log line and row (revert F43).

## Report

A table: mutation, killed/survived, killing test (file › name). For each survivor, one sentence on the
guarantee it breaks and the smallest test that would kill it — or why it is equivalent. Then the
commands and exit codes. Under 600 words; no file dumps.
