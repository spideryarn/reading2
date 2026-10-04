# Review and fix: sweep cluster 5, stage 2 — Regenerate's hold in six modes, Quiz's mark reader, Thread's stuck retry

Repo: this worktree, branch `worktree-sweep5-c5-failed-read`. You are the **reviewer-fixer**: fix
what is inside this commit's scope, narrowly and red-first; **report, do not fix**, anything wider.
Do not commit.

## The candidate

Committed: `fb514efd3`. `git diff 2cb2bfd10..fb514efd3`; paths:
`git diff --name-only 2cb2bfd10..fb514efd3`. The commit before the prompt commit that precedes it
holds your stage 1 review fixes (F13–F15), which are yours and unreviewed by anyone else.

Start with: `src/web/rewrite-hold.ts`, `tests/rewrite-hold.test.tsx`, `src/web/useStepJob.ts`
(the new `start` return value and `ended(id)`), `src/web/useQuiz.ts`, `src/web/lib/sse.ts`,
`src/web/useTweets.ts`, `src/web/useSketch.ts`. Then each of the five modes' hook and panel, and
the call sites of every forced verb. Not a limit on scope.

## What it is meant to do

The plan, § 2a and § 2c, with both ledgers of your plan-review findings:
`docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md`.
The statement to check for **accuracy**, not open-ended soundness — `rewrite-hold.ts`'s header:

> The hold is released by exactly three things: (1) a fresh read shows a different identity; (2) the
> job is known to have failed or been cancelled, or its POST was refused; (3) the job this press
> made is seen ended in a loaded, idle list, and a fresh read that started after the band saw that
> has landed. Fresh = started after the mark, and not an offline copy.

**Your F9 and F10 were P1s whose fixes you have not seen. Check those two specifically**: F9
(remount while the forced POST is in the air) is answered with the job's id rather than the plan's
`posted` boolean — the header says why; F10 (held on an offline copy with no way out) is answered
by `RewriteWaiting` in each panel. Known, stated limits: a full reload forgets the hold; a job
trimmed from the list before any band saw it ended stays held until a new artefact or a reload; a
job-level Retry after a failed forced run makes a new job with no hold.

Invariants: no second forced POST while held; the hold can always be left by a read-only control
or a real outcome (a hold with no way out is a P1 the other way); a retry control never spends; no
generic read hook; `readAnswerStream`'s existing callers behave as before.

## Evidence

The builder's account: every test in `tests/rewrite-hold.test.tsx` red first (F2 interleaving,
offline copy mounted and remounted, F9 remount, F10 recovery, per-mode table, direct controls);
mutations — drop provenance (41 fail), let an offline copy count (12 fail), ignore `posted` (F9
fails on all six), the plan's boolean (F9 fails). One existing fixture changed:
`quiz-regenerate-revalidation` § "lets go when the rewrite failed while closed" now lists the
failed job. I ran `npm run typecheck` (clean) and the six most relevant jsdom files (148 passed).
The full suite needs Postgres and is mine to run; run the jsdom files yourself.

## What I want

An independent attack first. Findings from **F18**, graded P0 data loss / security / incorrect
charging / broadly unusable; P1 user-visible wrong behaviour or an authoritative contract
violated; P2 design or maintainability risk; P3 prose. For each: fixed (with the red test) or
reported. End with one line: LAND, LAND WITH THE FIXES ABOVE, or DO NOT LAND.

## My own suspicions (already mine; spend most of the run elsewhere)

1. `run()`: if `start()` throws, is a hold left with `posted: null` for ever?
2. The rule-3 mark is a ref written during render. StrictMode / a discarded render?
3. Sketch: `profiled` was always false (the badge never drew); it now reads `profileHash` off the
   stored value, which makes a badge and its Regenerate appear in production for the first time. Is
   the claim true, and is the newly reachable control right?
4. Did the changed Quiz fixture lose what that test held? Is "trimmed before seen ended" reachable
   in ordinary use (KEEP_FINISHED)?
5. 2c: "a stall now keeps the partial reply" — an unpinned behaviour change in Quiz's marking.
6. Is `RewriteWaiting` drawn in every held-idle state in all six, including with a stale banner?
