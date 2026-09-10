# Narrow check: plan 260910f Stage 1, the fixes for F11 and F12

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/bounded-judgement`, branch
`worktree-bounded-judgement`. TypeScript, ESM, `tsx`; vitest.

This is a short correctness check of two fixes, not a full review. Twenty minutes.

## The candidate

Committed: 2eccd2a6 (parent f03d5571)
  git diff f03d5571..2eccd2a6
  changed paths: `git diff --name-only f03d5571..2eccd2a6`

Your two findings, verbatim, are in
`docs/plans/260910f-bounded-judgement-proposals-for-the-attention-inbox-stage1-review-sol-findings.md`.
Your earlier session was stopped by a content filter part-way through, so there is no closing answer
from it; the findings file is the whole record.

## What each fix should now guarantee

- **F11.** A day budget counts every reservation until the instance that made it settles it. A second
  `modelBudget({root})` on the same directory cannot settle a reservation it did not make, so the
  worst case stays counted and the day's ceiling holds. A crashed owner leaves its reservation
  charged at the worst case, by design.
- **F12.** When the pass tries to re-read a stale verdict and the budget refuses — `unavailable` or
  `stopped` — the sessions with that tail are counted as not judged. The stale card, if any, stays on
  the list. So an empty list in that state is `unknown` (or `limited`), never a list of zero items
  with zero unjudged sessions.

## What to check

1. Does each fix make its guarantee true on the paths the finding named? Run the new tests, and if
   useful the reproduction scripts from your earlier session if they are still in /tmp.
2. Did either fix change behaviour anywhere else — a stale verdict whose re-read SUCCEEDS now counted
   as unjudged, a normal single-instance settle now refused, a reservation id kept after a
   successful settle?

The tree is read-only for this check; /tmp is writable, and you can run one test file at a time
(`npx vitest run tests/<one>.test.ts`). No network.

**Write your conclusions FIRST to `/tmp/260910f-stage1-p1-check-findings.md`**, then put them in your
final answer. For each fix: holds / does not hold, with the evidence. Any new finding: ID from F13,
severity P0–P3, established or reasoned, the input that shows it, and the smallest fix. Do not change
any file in the repository.
