# Review, round 2: the revised plan for durable action receipts in the fleet dashboard

Repo: /home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts, branch
worktree-durable-action-receipts. TypeScript + ESM, tsx, vitest. The fleet dashboard is a single Node
process on a Linux box that types into ~36 Claude Code agent sessions in tmux panes and runs a few
enacted actions (kill processes, remove a git worktree).

## The candidate

Committed: the plan at `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md` as of
the commit that adds this prompt (run `git log -1 --format=%H -- docs/plans/260910d-durable-action-receipts-plan-review2-prompt.md`).
Round 1 reviewed b8f312a7; `git diff b8f312a7 HEAD -- docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md`
shows everything that changed. Your round-1 answer is
`docs/plans/260910d-durable-action-receipts-plan-review-sol.md`. This is still a PLAN review; nothing is built.

Code to check premises against (start there, not limited to it): `tools/fleet/hold-ledger.ts`,
`tools/fleet/quarantine.ts` (`QuarantineBook.hold/release/noteGeneration/rehydrate`,
`openSharedQuarantine`), `tools/fleet/queue.ts`, `tools/fleet/drain.ts`,
`tools/fleet/send-coordinator.ts`, `tools/fleet/routes-actions.ts` (enqueue, cancel, clear, abandon,
hold release, `fromAnotherRun`), `tools/fleet/routes-steer.ts`, `tools/fleet/server.ts:180-205`.

## What it is meant to do

Unchanged from round 1: restarting the dashboard cannot silently drop acknowledged queued work or
send an ambiguous message again, and a receipt explains what is proven and unknown; no automatic
retry; JSONL + atomic checkpoints; a dashboard-owned single-writer store outside worktrees; never a
writer of `~/.overseer/`; message text not copied into every record.

## What you can run, and what you may change

The tree is read-only. /tmp is writable; you can run one test file and a script; no network.

## Previous findings

| ID | Finding (round 1) | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | fail-open destroys durable idempotency | fixed | § Write-ahead: keyed `accepted` and any durable `attempted` fail closed |
| F2 | an acknowledged cancellation can be undone | fixed | § Write-ahead item 4; one `withdrawn` record per clear |
| F3 | the 5,000 cap invalidates the expiry proof | fixed | § Retention: admission cap, lookup before freshness, ±1 h for unknown ids |
| F4 | retention not enforced on disk | fixed differently | material in per-receipt files unlinked at terminal; compaction when the oldest terminal passes retention |
| F5 | fingerprint does not bind the body | fixed | whole validated body minus `requestId` |
| F6 | skipping unreadable lines can cause replay | fixed | § Restoring, last bullet |
| F7 | queued catalogue actions have no pinned material | fixed | full `SpokenAction` snapshot pinned |
| F8 | reconciliation states with no producer | fixed | existing gesture names only |
| F9 | no actor | fixed | § The actor |
| F10 | receipt recovery can lose the quarantine barrier | fixed differently | unknown unreconciled receipts rebuild holds at startup; `send-coordinator.ts` unchanged |
| F11 | "per press" does not solve a lost response | fixed | Stage 4 envelope |
| F12 | Stage 1 hides the receipt that explains a loss | fixed | minimal `GET /api/actions/receipts` in Stage 1 |
| F13 | restored queue ids break old gestures | fixed | original ids; hold-route foreign-id rule |
| F14 | generation-null restored items non-terminal for ever | fixed | journal `generation` records; conclude as `not-sent` |
| — | composition inside `openSharedQuarantine`; one claim; memory-only default | partly | one lock and `openFleetActionStores()` in server.ts (authorised). Memory-only default KEPT — see the plan's review table for why |

Treat the revisions as unreviewed text written by someone else, and spend most of the run on what
changed since b8f312a7.

## Attack it

The same invariant as round 1: find a sequence of requests, drain passes, write failures, crashes at
any line, restarts, tmux restarts and duplicate HTTP requests after which the same keystrokes or the
same enacted plan are delivered twice, acknowledged queued work vanishes without a receipt saying so,
or a receipt claims something proven that was not. Pay particular attention to the two places the
plan chose a different fix from the one you proposed (F4's material files, F10's rebuild-from-receipts
barrier) and to any new state the revisions introduced (`recovery-blocked`, `tmux-generation-*`,
`not-durable`, `interrupted-before-attempt`, the `generation` record) — does each have a producer, and
is each claim true?

Question with a floor: is the plan's statement of each guarantee **accurate as written**? Not "is it
sound in every conceivable environment".

For each finding: an ID continuing from F15, a severity (P0 data loss / exploitable security /
service broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2
design risk, no wrong behaviour today; P3 prose), established or reasoned, (a) the concrete scenario,
(b) exact replacement wording. Refuse only on an established P0 or P1 and name what established it.
End with one line: "proceed", "proceed with the changes in F…", or "rework".

## My own suspicions — read last

1. Restoring under ORIGINAL item ids: can a restored `<oldrun>-q3` collide with anything, and is
   `fromAnotherRun`'s new rule (refuse a foreign id only when absent) safe for cancel, revive, abandon
   and clear alike?
2. The unattributable-unreadable-line rule concludes every restorable queued receipt as unknown. Is
   that too blunt, and does it also need to rebuild holds (it would under F10's rule — is that right
   for items that were merely queued)?
3. Keyed fail-closed `accepted` returns 503 when the disk is full. Is there a path where an UNKEYED
   request quietly becomes the fallback and repeats?

Do not change any file.
