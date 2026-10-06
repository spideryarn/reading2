# Code review, stage C: slices out of time hand the job back for another window

You are reviewing built code, and you may fix what you find, narrowly. Nobody else is editing
this tree now.

## The candidate

Commit `e2cc2af40` in this worktree (`git show e2cc2af40 --stat`). Paths:
`src/another-window.ts` (new), `src/jobs.ts`, `src/structure.ts`, `src/pipeline.ts`,
`src/structure-slices.ts` (comments), `tests/structure-step-another-window.test.ts` (new),
`tests/job-hands-back-for-another-window.test.ts` (new, needs Postgres),
`tests/structure-slices-queue.test.ts`, `tests/store-migration-registry.ts`,
`docs/project/structure-step.md`, `docs/project/ingest-queue.md`,
`evals/long-structure/fallback-arithmetic.ts`. Start with `runStep`'s catch and the walk's
pause block in `src/jobs.ts`; that does not limit scope.

Also in scope as **unreviewed code by someone else**: your own B1 fix from the last round
(`timedOut ||= Date.now() >= expiresAt` in `src/structure-slices.ts`), committed as the commit
before this one. A narrow check only.

The plan: `docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md`,
"### Plan: the rest of stage 1a (2026-10-06)", stage C, and F3, F4 in the review record after it.

This touches the job queue, which has real, paying readers behind it. Grade accordingly.

## Your edits

Fix what is inside this commit, red-first; report, do not fix, anything wider. Do not commit.
Do not invent quotations from anyone.

## Evidence I am handing you, because your sandbox cannot reach Postgres

Run by me on this commit: see the raw output appended at the end of this file. Run yourself
what needs no database: `npx vitest run tests/structure-step-another-window.test.ts
tests/structure-slices-queue.test.ts` (say so if they will not run; do not skip silently).

## Independent pass first

1. Every path from `NeedsAnotherWindow` to an ending: `requeued`, `stale`, `cancelled`,
   `budget-spent`. Is each ending the one the deadline branch gives, is anything written to the
   job row, the draft, the published revision or the ledger that should not be, and is anything
   that should be written missing?
2. Can a job loop: hand back, be reclaimed, and hand back for ever? What bounds it, and is the
   bound the queue's (`REQUEUE_BUDGET`) in every store implementation (Postgres; any filesystem
   or in-memory adapter still present)?
3. `runStep`: is anything recorded that makes the step look failed to the reader or to
   `stepIsDone` after a hand-back (error text, `captureFailure`, Sentry, a `blocked` settle)?
   Is the in-flight draft's structure artefact untouched?
4. Can `NeedsAnotherWindow` be thrown in a context with no walk to catch it (the command line,
   `runJob` as opposed to `advanceJob`, an eval, a route that calls `generateStructure`
   directly)? `window` is absent there by design: check every caller of `generateStructure` and
   every place a `StepContext` is built.
5. A reader's Stop racing the throw. The builder found that removing `!stopped` in `runStep`
   changes no outcome (the store's pause answers `cancelled`). Is the guard right to keep?
6. First import vs an article with a published real tree: what does the reader see during the
   extra windows, and does anything (labels job, main-mode jobs, `needsRealStructure`) misbehave
   while the structure job is `queued` again?
7. The builder's two findings, now in `docs/project/structure-step.md`: `out-of-time` also covers
   a required call past its own cap, so a hand-back can come early; and a window that buys no
   answer still spends one. Is either worse than stated (for instance, a slice whose call always
   exceeds its cap spending all three windows and then falling back: that is three times the
   wait for the same result)? Say what you would do, and whether it is this stage's.
8. Docs and comments that now lie; the arithmetic script's new line.

## Severity and verdict

P0 data loss, security, wrong charging, service unusable. P1 user-visible wrong behaviour or an
authoritative contract violated. P2 design or maintainability risk. P3 prose. An ID on every
finding (C1, C2, …), a severity, **established** or **reasoned**, and whether you fixed it. End
with a verdict (land / land with the fixes made / do not land) and the files you changed.

## My own suspicions, worth less than your pass

- Charging: a first import is a paid ingest slot. Does a hand-back, or the `budget-spent`
  ending after one, settle the reservation any differently from the deadline branch?
- `tests/store-migration-registry.ts` gained a lane entry for the new Postgres test. Is that
  the right lane, and does anything else need to hear about a new Postgres-backed test file?

## Raw output of the Postgres-backed tests, run by me

     ✓ |unit| tests/structure-step-another-window.test.ts > slices out of time, with a further window available > hand back and return no tree, when no call could be started 89ms
     ✓ |unit| tests/structure-step-another-window.test.ts > slices out of time, with a further window available > hand back with the answers bought kept, and the next window buys only what is missing 5974ms
     ✓ |unit| tests/structure-step-another-window.test.ts > slices out of time, with a further window available > a root call past its cap hands back too: it is `out-of-time`, not `root-call-failed` 69ms
     ✓ |unit| tests/structure-step-another-window.test.ts > slices out of time, with no further window > return the headings tree, as before, when the budget is spent 3405ms
     ✓ |unit| tests/structure-step-another-window.test.ts > slices out of time, with no further window > return the headings tree, as before, when nobody said anything about windows 3146ms
     ✓ |unit| tests/structure-slices-queue.test.ts > stage E through the queue without a database > out of time with a window left, the job is put down and no structure product is committed 56ms
     ✓ |unit| tests/structure-step-another-window.test.ts > slices out of time, with no further window > the command line, with no deadline at all, is unchanged: a call past its own cap gives the headings tree 3155ms
     ✓ |unit| tests/structure-step-another-window.test.ts > slices out of time, with no further window > the command line, with no deadline at all, still finishes in slices 3289ms
     ✓ |unit| tests/structure-step-another-window.test.ts > only running out of time hands back > a slice that fails in both passes is the headings tree, window or not 3112ms
     ✓ |unit| tests/structure-step-another-window.test.ts > only running out of time hands back > a root call that fails twice is the headings tree, window or not 2973ms
     ✓ |unit| tests/structure-step-another-window.test.ts > only running out of time hands back > a finished run with a window available is a finished run 3043ms
     ✓ |unit| tests/structure-step-another-window.test.ts > only running out of time hands back > a reader's Stop is a cancellation and not a hand-back 23ms
     ✓ |private-postgres| tests/job-hands-back-for-another-window.test.ts > slices out of time, in a job the queue can give another window > a first import is put down with its answers and its draft kept, and the next window finishes from them 14713ms
     ✓ |private-postgres| tests/job-hands-back-for-another-window.test.ts > slices out of time, in a job the queue can give another window > over an article already published with a real tree, the published tree is untouched while the job is put down 5432ms
     ✓ |private-postgres| tests/job-hands-back-for-another-window.test.ts > slices out of time, in a job the queue can give another window > a Stop pressed while the slices ran is a cancellation, not another window 562ms
     ✓ |private-postgres| tests/job-hands-back-for-another-window.test.ts > slices out of time, in a job the queue can give another window > a claim that moved while the slices ran writes nothing: the lost-claim path 677ms
     ✓ |private-postgres| tests/job-hands-back-for-another-window.test.ts > slices out of time, in a job the queue can give another window > a budget spent between the step starting and the pause ends as an interruption, not on the headings tree 633ms
     ✓ |private-postgres| tests/job-hands-back-for-another-window.test.ts > slices out of time, in a job the queue can give another window > with the budget already spent, the step finishes on the headings tree, as it did 5122ms
     ✓ |private-postgres| tests/jobs-walk.test.ts > one claim walks the whole job > hands every step the power `parts.power` reads for it, and the wire follows (plan 260930f) 494ms
     ✓ |private-postgres| tests/jobs-walk.test.ts > one claim walks the whole job > hands the claim back rather than starting a step it cannot finish 513ms
     ✓ |private-postgres| tests/step-failure-seam.test.ts > an error nobody wrote a reader sentence for > is still offered another go, because nobody said it could not work 121ms
     ✓ |private-postgres| tests/step-failure-seam.test.ts > an error that declared its reader sentence > lets its kind decide whether another go is offered 254ms
     Test Files  6 passed (6)
          Tests  55 passed (55)
