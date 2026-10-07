# Code review, stage B: the root call's second chance (and the fix for your A1)

You are reviewing built code, and you may fix what you find, narrowly.

## The candidates

Two commits in this worktree:

- `b18de4c3b`, stage B. Paths: `src/structure-slices.ts`, `src/structure.ts`, `src/pipeline.ts`,
  `tests/structure-slices-second-pass.test.ts`, `tests/structure-slices-adversarial.test.ts`,
  `tests/structure-step-slices.test.ts`, `tests/structure-step-headings-first.test.ts`,
  `docs/project/structure-step.md`. Start with `runSlices`' root call (`askRoot`), `ask`, `not`
  and the `Need` type; that does not limit scope.
- `dcb5f6cc1`, the fix for A1 of your own stage A review
  (`docs/plans/261005j-stage-1a-rest-A-code-review-sol.md`): `src/labels.ts`
  (`LABEL_RETRY_HEADROOM`, `canAskFor`), `tests/labels-batching.test.ts`,
  `tests/labels-shortfall.test.ts`, `tests/structure-step-bounded-fallback.test.ts`,
  `docs/project/structure-step.md`. **This is a narrow check of that fix, not a new discovery
  round on stage A.** Note that your own prose fixes from that review (`2c8359d66`) sit between.

The plan: `docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md`,
"### Plan: the rest of stage 1a (2026-10-06)", stage B, and F2 in the review record after it.

## Your edits, and their limits

**Another agent is editing `src/jobs.ts`, `src/pipeline.ts`, `src/structure.ts`, `src/store/*`
and new test files in this same tree while you work (stage C). Do not edit those files, and
ignore uncommitted changes in them.** You may edit `src/structure-slices.ts`, `src/labels.ts`,
the tests named above, and `docs/project/structure-step.md`. Fix what is inside these two
commits, red-first; report, do not fix, anything wider. Do not commit. Do not invent quotations
from anyone.

## Independent pass first

Attack it, and run things: `npx vitest run tests/structure-slices-second-pass.test.ts` and
`tests/labels-shortfall.test.ts` should need no network (say so if they do; do not skip
silently).

1. Every ending of the root call: transport failure, invalid answer then invalid re-ask,
   refusal, cut-short, its time cap, admission denied for want of time, a reader's Stop before,
   during and between the two asks, a checkpoint hit. For each: how many calls, what is latched,
   what the run reports, whether `rootAskedTwice` is right, and whether usage is counted.
2. Can the second ask clear, mask or outlive a failure that belongs to earlier slice work? Can
   the root now be reached in a state where before it was not?
3. Is the checkpoint written and read correctly across the two asks (same key; a good answer
   to the first ask that arrives late)?
4. `structureSourceDetail`'s wording for the four combinations.
5. A1's fix: is "askable including the re-draw" now true of every plan, and is
   `LABEL_RETRY_HEADROOM` really the one value both the planner and the re-draw read?
6. Docs and comments that now lie.

## Severity and verdict

P0 data loss, security, wrong charging, service unusable. P1 user-visible wrong behaviour or an
authoritative contract violated. P2 design or maintainability risk. P3 prose. An ID on every
finding (B1, B2, …), a severity, **established** or **reasoned**, and whether you fixed it. End
with a verdict per commit (land / land with the fixes made / do not land) and the files you
changed.

## My own suspicions, worth less than your pass

- The builder said the tests for refusal, cut-short, time-out and no-time were red only because
  the field did not exist, and that the `why === "failed"` guard is redundant with the latch
  (a mutation removing it survived until a store read count was asserted). Is the guard worth
  keeping, or is one of the two the wrong place for the rule?
- The first ask is now `need: "second-chance"`, a `Need` written for slices. Does anything else
  in `ask`/`not` key on that need in a way that is wrong for the root (halving, `secondPass`
  counting, the pool)?
