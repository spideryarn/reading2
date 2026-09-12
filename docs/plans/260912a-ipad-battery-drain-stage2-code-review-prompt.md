# Review: every job subscriber now has to say whether it watches the queue (stage 2, your F12)

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain, branch
worktree-fb36-ipad-battery-drain. TypeScript + ESM, React 19 client under `src/web/`, vitest.

## The candidate

Committed: **HEAD**, the stage-2 commit. Its first parent is a merge of `origin/dev`, which is not
part of this candidate. `git diff HEAD~1..HEAD` is the whole change; `git diff --name-only
HEAD~1..HEAD` lists the paths. (I will record the SHA in the plan's log once this review is back.)

Start with: `src/web/useJobs.ts` (the new required argument and its type), `src/web/useStepJob.ts`,
`src/web/useArc.ts`, and the type-level test the change added. Then every call site in the diff.
Where to begin, not the limit.

## What it is meant to do

Your code review of stage 1 (`docs/plans/260912a-ipad-battery-drain-code-review-sol.md`, F12) said
the default still bundled the eight-second idle cadence into every `useJobs()`/`useStepJob()`, so
the class in the postmortem (`docs/postmortems/260912a-a-budget-a-comment-keeps-is-spent-by-the-next-call-site.md`)
could recur at any call site the whole-`App` owner guard does not watch. Stage 2 makes the choice a
required argument, so the compiler refuses a caller that has not made it. The plan's § "Stage 2"
says why a required choice and not a quiet default: a quiet default would make the opposite mistake
silent — a new band that forgot to ask would stop showing another tab's run and look broken.

**It must change no behaviour.** `useArc` stays quiet; every other caller that watched the queue
before this commit still watches it. Stage 1 and your round-1 fixes (F8–F11) are already committed
and reviewed; they are context, not the candidate.

## What you may change

You may edit this worktree. Fix what is inside this stage — each finding red-first, with the test
that reproduces it — and leave everything wider as a finding for me to decide. Do not commit. List
every file you changed at the end. You have no network, not even loopback.

## Attack it

Independently, before you read my question below.

1. Find a caller whose choice is wrong — one that watched the queue before and is now quiet, or the
   reverse — or any `useJobs`/`useStepJob` caller the diff missed. Grep for yourself; do not trust
   the diff's list.
2. Is the choice actually impossible to omit? Look for a default, an optional overload, a spread
   of an options object, or a wrapper that forwards `undefined`, through which a new caller could
   still get the cadence without saying so. Does the type-level test fail if the argument became
   optional again?
3. Is `useSyncExternalStore` still handed a stable subscribe function for each choice?

For each finding give an ID continuing from F12 (F13, F14, …), a severity (P0/P1/P2/P3 — P0 data
loss, security, incorrect charging or broadly unusable; P1 user-visible wrong behaviour or an
authoritative contract violated; P2 design risk, no wrong behaviour today; P3 prose), established or
reasoned, (a) the input or mutation I can run, (b) the smallest change that closes it. A finding
with no (a) goes last. Refuse only on an established P0 or P1.

## My own suspicion — read last

Already mine, so confirming it is worth less than anything you find yourself: the hover card's
`WithAddToShelf` is given "watches the queue", which keeps your stage-1 F3 exactly as it was
(deferred in the plan). Is that the right call for *this* stage, or does naming the choice at that
call site make the quiet-until-pending version cheap enough that deferring it is now wrong?
