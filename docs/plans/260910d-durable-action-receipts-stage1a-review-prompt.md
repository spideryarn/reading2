# Review: Stage 1a of plan 260910d — the receipt journal, and the hold ledger over a shared core

Repo: /home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts, branch
worktree-durable-action-receipts. TypeScript + ESM, tsx, vitest.

## The candidate

Committed: the single commit whose subject begins "Stage 1a of 260910d" — find it with
`git log -1 --format=%H --grep='^Stage 1a of 260910d'`; its parent is the plan commit 4ffbb187.
`git diff 4ffbb187 <that sha> -- tools/ tests/` is the code. Changed paths:
`tools/fleet/journal-file.ts` (new), `tools/fleet/receipt-journal.ts` (new),
`tools/fleet/action-stores.ts` (new), `tools/fleet/hold-ledger.ts`, `tools/fleet/quarantine.ts`,
`tests/fleet-receipt-journal.test.ts` (new), `tests/fleet-action-stores.test.ts` (new). The same
commit also touches two docs under `docs/plans/`; those are not the candidate.

Start with `receipt-journal.ts` and the `quarantine.ts` diff. That is where to begin, not the limit.

## What it is meant to do

The spec is `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md` — § The design is
authoritative — and the brief it was built from is `docs/plans/260910d-durable-action-receipts-stage1a-task.md`.
Both plan reviews (`…-plan-review-sol.md`, `…-plan-review2-sol.md`) and the plan's review tables say
why each rule is there. In one paragraph: a single-writer JSONL receipt journal beside the hold ledger,
opened under ONE shared `writer.lock`; strict records and a transition rule; message material in
per-receipt 0600 files, deleted at every outcome; recovery that fails closed on unreadable evidence
as far as it could hide an attempt; id reservation; 7-day keyed retention with an admission cap
rather than eviction. **Nothing is wired into the queue, drain or routes in this stage** (Stage 1b).
**A receipt never installs, extends or ends a hold** — the hold ledger is the only barrier.

The hard constraint: `tests/fleet-hold-ledger.test.ts`, `tests/fleet-hold-restart.test.ts` and
`tests/fleet-quarantine.test.ts` pass **unedited** — the proof the extraction preserved the hold
ledger's behaviour. Do not edit those three files.

## What you may change

You may edit this worktree. Fix what is inside this stage — each finding red-first, with the test
that reproduces it — and leave everything wider as a finding for me to decide. Do not commit, do not
run git commands that change the index or history. Do not edit `server.ts`, `queue.ts`, `drain.ts`,
the route files, `send-coordinator.ts`, `tools/overseer/` or `tools/fleet/web/`. List every file you
changed at the end.

You can run single test files (`npx vitest run tests/<one>.test.ts`) and `node --import tsx
scripts/typecheck.ts`; none of these tests needs the network. My own run of the gates, before your
review: seven files (`fleet-hold-ledger`, `fixture-ids`, `fleet-receipt-journal`, `fleet-hold-restart`,
`fleet-action-stores`, `fleet-send-composition`, `fleet-quarantine`), 138 tests, all green;
typecheck exit 0 across all four projects.

## Attack it

Independently, before my suspicions below. The invariants to break:

1. After any sequence of appends, write failures, lock loss, torn or unreadable lines and reopenings,
   the folded state on disk would let Stage 1b **restore and deliver** an item that may already have
   been attempted, or **forget** a durably accepted item that was never attempted, withdrawn or
   concluded.
2. A keyed receipt disappears (by compaction or eviction) before 7 days, or an id is minted twice
   within retention.
3. Message text survives on disk after the receipt's outcome — in the material directory, a
   temporary sibling, the journal, or the unreadable side file — without `materialDeletionPending`
   saying so.
4. The hold ledger behaves differently from before the extraction in any way its tests do not cover
   (lock loss, close, compaction, a second opener).
5. Two dashboards can both write, or one can repair or delete while locked out.

Question with a floor: is each guarantee accurate **as the plan states it**?

For each finding: an ID continuing from F22, a severity (P0 data loss / exploitable security /
service broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2
design risk, no wrong behaviour today; P3 prose), established or reasoned, (a) the input or mutation
that shows it, (b) what you changed, or the smallest change if it is outside the stage. Refuse only on
an established P0 or P1. End with one line: "land", "land with the fixes above", or "rework".

## My own suspicions — read last

These are already mine; confirming them is worth less than anything you find yourself.

1. **My brief contradicted itself, and the code follows the wrong half.** It said memory changes
   only when bytes land, but the plan says an unkeyed enqueue fails open. So `accept()` without a
   `requestId` returns `ok: false` when the core's append fails while the lock is held. It should
   succeed with `durable: false`, keeping that receipt and its later transitions in memory. Keyed
   accepts, and `attempted`/`withdrawn` for durably accepted receipts, must still refuse. Please fix
   this red-first.
2. After a durable receipt's `returned` write fails, memory stays at `attempted`, so the next
   `attempted` for the item is an illegal transition and Stage 1b would hold it `not-durable` for
   the rest of the run. I think that is safe but ugly; say whether you agree.
3. The composition lives in `quarantine.ts`, with `action-stores.ts` only re-exporting it. I intend
   to move it in Stage 1b once the legacy `openSharedQuarantine()` has no callers. Report anything
   that makes that move harder; do not move it now.
4. `unkeyedTerminalCap` defaults to `KEYED_RECEIPT_CAP` (5,000), which conflates two limits.

Report findings, fixes, checks run and their exact results. Ensure the answer file is non-empty.
