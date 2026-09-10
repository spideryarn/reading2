# Review: a plan for durable action receipts in the fleet dashboard

Repo: /home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts, branch
worktree-durable-action-receipts. TypeScript + ESM, run with tsx, tests with vitest. The fleet
dashboard is a single Node process on a Linux box that types into ~36 Claude Code agent sessions
running in tmux panes, and runs a few enacted actions (kill processes, remove a git worktree).

## The candidate

Committed: commit b8f312a7 — one new file,
`docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md`.
`git show b8f312a7` prints it. This is a PLAN review: nothing is built yet.

Start with the plan, then the code it proposes to change: `tools/fleet/hold-ledger.ts` (the store it
extends), `tools/fleet/queue.ts`, `tools/fleet/drain.ts`, `tools/fleet/send-coordinator.ts`,
`tools/fleet/quarantine.ts` (`openSharedQuarantine`), `tools/fleet/routes-actions.ts`
(`makeActionRoutes`, `sessionRoute`, `enqueue`, `boxRoute`, `killRoute`, the abandon and hold-release
routes), `tools/fleet/routes-steer.ts` (`run`, around lines 940-1210), `tools/fleet/routes-broadcast.ts`
(`run`), `tools/fleet/steer.ts` (`fire`, `mayHaveLanded`), `tools/overseer/jsonl.ts`,
`tools/overseer/lock.ts`. The spec it answers is the roadmap stage at
`docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` line 1379 ("Durable action receipts")
and `docs/plans/260908j-delivery-receipts-and-honest-outcomes-for-the-fleet-dashboard.md` § Stage 5.
Those are where to begin, not the limit of scope.

## What it is meant to do

Acceptance, from the roadmap: restarting the dashboard cannot silently drop acknowledged queued
work or send an ambiguous message again, and a receipt explains what is proven and what is unknown.
No automatic retry of keystrokes, ever; tmux cannot give exactly-once and the plan must not claim it.
Constraints: JSONL + atomic checkpoints (no SQLite/Postgres); a single-writer store owned by the
dashboard, outside worktrees; never a second writer of the Overseer's `~/.overseer/`; sensitive
message text not copied into every record. The job is staged so the first landing (queued work
survives a restart) is useful alone.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and build a
throwaway harness under /tmp. No network, not even loopback. The fleet tests
(`tests/fleet-hold-ledger.test.ts`, `tests/fleet-hold-restart.test.ts`, `tests/fleet-queue.test.ts`,
`tests/fleet-drain.test.ts`) need nothing outside the tree if you want to check a premise.

## Attack it

Independently, before you read my questions below. The invariant to break: **there is a sequence of
events — requests, drain passes, journal write failures, crashes at any line, restarts, tmux
restarts, duplicate HTTP requests — after which the same keystrokes or the same enacted plan are
delivered twice, or acknowledged queued work vanishes without a receipt saying so, or a receipt
claims something proven that was not.** Also: is anything in the state machine unproducible (an arm
no code can reach), is the fingerprint's field list right, and does the retention/expiry arithmetic
actually guarantee that a forgotten request id is refused rather than treated as new?

Also judge the staging and the size: is there a materially smaller design that meets the acceptance
sentence, and is extracting a shared core out of `hold-ledger.ts` the right call versus a sibling
file shaped like it?

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — exact replacement wording for the plan
A finding with no (a) goes last.

Severity: P0 data loss, exploitable security, or the service broadly unusable; P1 user-visible
wrong behaviour or an authoritative contract violated; P2 design or maintainability risk with no
wrong behaviour today; P3 prose. Refuse only on an established P0 or P1, and name what established it.

End with a one-line verdict: "proceed", "proceed with the changes in F…", or "rework".

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. Restored queued items get NEW item ids from the new run. Is there a path where the receipt↔item
   link breaks, or where an old-id cancel from a phone is refused while the item then delivers
   something the person believed they had cancelled?
2. Opening the receipt journal inside `openSharedQuarantine()` to avoid touching `server.ts` — is
   that braiding two stores' lifecycles in a way that will hurt, and is the "memory-only unless
   opened" default enough to keep tests from writing to the real `~/.fleet-holds/`?
3. The generation guard invalidates restored items whose recorded tmux generation was null. Is that
   too conservative in practice (an item enqueued in the first ~73 s of a run) or not conservative
   enough?
4. The queue writing its own receipts (rather than the routes) — does that couple `queue.ts` to the
   journal in a way that hurts the queue's pure, clock-injected testability?

Do not change any file.
