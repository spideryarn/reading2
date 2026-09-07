# Review a plan to fix two safety guards that cannot fire

You are reviewing a **plan**, before it is built. Repo:
`/home/greg/code/spideryarn2/.claude/worktrees/sweep-self-stamp` (a git worktree of a
TypeScript/ESM project). You can run things. Read the code and check the numbers
yourself; do not take the plan's summaries on trust.

## The plan

`docs/plans/260907e-fix-the-two-guards-that-agree-with-the-thing-they-watch.md`

## The code it changes

- `scripts/worktree-sweep.ts` — classifies git worktrees as removable or not
- `scripts/worktree-check.ts` — the "does this tree hold work" judgement it calls
- `scripts/check-staged-revert.ts` — the guard in the commit recipe every agent runs
- `tests/worktree-sweep.test.ts` — the existing tests, which run against real git

## Context

~18 git worktrees, one per AI agent, on one box, all sharing one primary checkout.
`.claude/worktrees` is 14G with 21G free. 11 of them are fully merged into
`origin/dev` — finished work still on disk. `npm run worktree:sweep` exists to
reclaim them and reports "nothing to remove", every time, and always has.

Both bugs are the same shape: a check that shares an assumption with the thing it
watches, so it agrees with it. The repo has a name and a postmortem series for this
(`docs/reusable/silent-success.md`;
`docs/postmortems/260906e-a-guard-that-agreed-with-the-thing-it-was-watching.md`).

House rules that bear on your answer: **prefer simple over easy**, **simplest version
first**, **let the types catch it**, and **a check you have never seen fail is not
evidence**.

## What I want from you, weighted in this order

1. **Is any diagnosis wrong?** There are four claims, each backed by a measurement
   quoted in the plan. Reproduce them:
   - `git status` in a worktree stamps `.git/worktrees/<name>`'s mtime, which
     `lastActivityAt` then reads back as activity; `--no-optional-locks` avoids it.
   - `git log -g --format=%ct <ref>` returns the **commit's** date, not the reflog
     entry's, so the shipped branch-reflog signal duplicates the commit-date signal
     and neither one moves when a worktree is created or fast-forwarded.
   - `expect(lastActivity).toBeGreaterThanOrEqual(headTime)` at
     `tests/worktree-sweep.test.ts:154` is vacuous, and that test's comment claims a
     backdated commit the code never creates.
   - `check:staged-revert` reports the incoming side of a merge as a revert, and
     tells you to `git reset` it away.

   If a number is wrong or a mechanism is misdescribed, that outranks everything else
   here.

2. **Does either fix fail in the dangerous direction?**

   For the sweep, dangerous means *under*-reporting activity: a live worktree with an
   agent working in it, classified as idle and offered for removal. Removal is
   one-at-a-time, behind a re-check and behind `git worktree remove` without
   `--force` — but a gitignored `data/` holding an expensive pipeline run is
   invisible to git's own refusal, so `blockers()` is the only guard there.
   **Construct the case where the reflog-entry timestamp reads older than the
   truth.** Does a reflog expire, get pruned, or get disabled
   (`core.logAllRefUpdates=false`, a bare-ish config, `advice.*`)? What happens in a
   worktree whose branch was created elsewhere? What does an agent editing files for
   six hours without any git command produce — and is that covered by `dirty` instead?

   For `check:staged-revert`, dangerous means a genuine stale index that now slips
   through because a merge is in progress. **Construct one.**

3. **Is the `MERGE_HEAD` rule right?** The plan says: during a merge, a path whose
   staged blob equals `MERGE_HEAD:<path>` is the incoming side, not a revert. Is
   there a better rule — comparing against the merge base, or `git merge-tree` to
   compute what the merge *should* produce and diffing the index against that? Or is
   the honest answer that the check cannot answer its question mid-merge and should
   say so loudly rather than half-answer it? What does each option cost, and which
   would you ship?

4. **Are the calibration tests actually calibrated?** Each is meant to be able to
   fail. The first asserts that classifying twice yields the same `lastActivity`
   (with a real 1.1s sleep) — is that a real test of the property, or can it pass
   vacuously? The second is described but not yet written; say what it must assert to
   be worth having.

5. **Is anything over-built, and is anything missing?** Name what to cut. If you think
   one of the two fixes is not worth making, say so. And if there is a cheap general
   move that prevents the *class* rather than these two instances, that is worth more
   than either fix — the plan does not currently propose one.

Be concrete and quote `file:line`. Be willing to say the plan is wrong; I have already
had to retract one version of fix (b) after an experiment contradicted it, so I would
rather be corrected than agreed with. Check your own conclusions before sending — if
you talked yourself out of an inconvenient finding, include it anyway and say why you
set it aside.
