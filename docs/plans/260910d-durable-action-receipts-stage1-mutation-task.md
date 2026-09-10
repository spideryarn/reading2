# Task: mutation-test Stage 1 of plan 260910d (1a and 1b together)

You are checking whether the test suite would NOTICE if the guarantees of Stage 1 were broken. A
test that stays green under a mutation that breaks a guarantee is a finding. You do not fix code; you
report.

## Where to work — your own worktree, never the author's

You were started with an isolated worktree. In it, bring in the author's branch with
`git merge --no-edit worktree-durable-action-receipts` (a merge, never a rebase, checkout or reset).
Run `npm run worktree:setup` if `node_modules` is missing. **Never touch
/home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts** — another session is working
there. Never commit or push. Undo each mutation by editing the text back.

Read `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md` § The design first.

## The gate for each mutation

`npx vitest run tests/fleet-receipt-journal.test.ts tests/fleet-action-stores.test.ts
tests/fleet-receipt-restart.test.ts tests/fleet-hold-ledger.test.ts tests/fleet-hold-restart.test.ts
tests/fleet-quarantine.test.ts tests/fleet-queue.test.ts tests/fleet-drain.test.ts
tests/fleet-actions-route.test.ts` — record **killed** (at least one test red) or **survived**, and
for a kill, which test killed it. Read the exit code, not a piped tail.

## The mutations — one at a time, each reverted before the next

`tools/fleet/receipt-journal.ts`
1. `validTransition`: allow `attempted` after `attempted`.
2. Recovery: stop concluding a dangling `attempted` as `outcome-unknown`/`interrupted`.
3. `restorable()`: stop skipping `recoverySuppressed` receipts.
4. Stop deleting material when an `outcome` lands.
5. Retention: `RETENTION_MS` to one day.
6. Keyed cap: evict the oldest keyed receipt instead of refusing the accept.
7. `admitUnknownRequestId`: widen the skew to 8 days.
8. `attempted()`: always `failOpen: true` (a durable receipt's attempt "lands" in memory without disk).
9. `withdrawn()`: apply to memory before the durable record lands.
10. Envelope rule: treat an unattributable unreadable line as blocking nothing.

`tools/fleet/journal-file.ts`
11. Remove the `stillOurs` check before `append`.
12. Take the lock after `truncateToLastLine` instead of before.

`tools/fleet/queue.ts`
13. `cancel`: remove the item from memory before `withdrawn`, and ignore its result.
14. `beginDelivery`: return ok even when a durable receipt's `attempted` did not land.
15. `restore()`: stop skipping an item whose receipt is already in the queue.
16. The restore generation guard: let a restored item with a null generation through.
17. Restore a spoken action by re-resolving `actionById(id)` instead of the pinned snapshot.
18. `push`: put the item in memory before `accept`.

`tools/fleet/drain.ts`
19. Remove the `beginDelivery` call from `deliverOne`.

`tools/fleet/routes-actions.ts`
20. `fromAnotherRun`: refuse every foreign-run id again, whether or not an item has it.

`tools/fleet/server.ts` (source guard)
21. Move the `openFleetActionStores(` call below `createServer(handler)`.
22. Add a separate `openReceiptJournal(` call below the listener.

## Report

A table: mutation number, killed/survived, the killing test (file and name). Then, for every
survivor, one sentence on which guarantee it breaks and the smallest test that would kill it. Then the
exact commands you ran and their exit codes. Keep it under 600 words. Do not paste file dumps.
