# Plan review: the rest of stage 1a of the long-document structure plan

You are reviewing a short plan before anything is built. Read-only: do not edit any file.

## The candidate

`docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md`,
the section **"### Plan: the rest of stage 1a (2026-10-06)"** only (uncommitted in this worktree;
base is `HEAD`). The rest of that file is background, already reviewed.

## What to read

- `src/labels.ts`: `planBatches`, `unaskableBatches`, `labelCallBudget`, `oversizedSets`,
  `assertCoversEveryBlock`, `MAX_BATCH`, `MIN_BATCH`, and what consumes a `Batch`/`SiblingSet`
  (the prompt builder, `runBatch`, the batch records, `mergeLabels`, the checkpoint key).
- `src/structure.ts`: `generateStructure`, the two `unaskableBatches` call sites, `StructureSource`.
- `src/structure-slices.ts`: `runSlices`, the root call at its end, `ask`, the second pass,
  `slicesDeadline`, `SlicesFailure`.
- `src/heading-tree.ts`: `windows` inside the bounded builder.
- `src/jobs.ts`: the walk's mid-step hand-back ("We ran out of our own time inside a step"),
  `overran`, `DeadlineReached`, `REQUEUE_BUDGET`, `runStep`'s catch, where `StepContext` is built
  (`stepBudgetMs: STEP_BUDGET_MS[step.name]`); `src/store/jobs.ts` § `PauseOutcome`;
  `src/pipeline.ts` § `STEPS.structure` and `StepContext`.
- `src/store/pg-successor.ts` § `enqueueSuccessorIn` and `src/store/pg-revisions.ts` around
  `structureSuccessor`, for the option the plan passes over.

## Independent pass first

Attack the three stages (A, B, C) as designs. For each: is the claim about today's code true, is
the change sound, what does it break, what test is missing, and is there a simpler way. Tell me
plainly if a stage is not worth building.

Claims to check against the code, not the prose:

1. A planned labels batch is unaskable only when a single sibling set has more than 2,032 leaves.
2. After A, no plan can hold an unaskable batch, so `labels-could-not-ask` is unreachable and can
   be deleted from both unions.
3. Nothing downstream of `planBatches` assumes one sibling set per parent node.
4. The root call today is asked once (plus one re-ask of an answer that does not pass), and a
   transport failure or a time-out of it discards every slice.
5. The slices path never reaches the walk's mid-step hand-back, because it stops itself early
   and returns a finished step.
6. A requeued window re-runs `generateStructure` with the same checkpoints and so buys only what
   is missing; the draft and, for a first import, the published stand-in tree are untouched.
7. Publishing an `awaiting-structure` tree from inside a `["structure"]` job would collapse the
   successor insert onto the publishing job itself.

## Severity and verdict

P0 data loss, security, wrong charging, service unusable. P1 user-visible wrong behaviour or an
authoritative contract violated. P2 design or maintainability risk, no wrong behaviour today.
P3 prose. Give every finding an ID (F1, F2, …), a severity, and **established** (direct evidence:
an exact reachable source path, or a run) or **reasoned**. Verdict: build / build with changes /
do not build, per stage.

## My own suspicions, worth less than your pass

- C: throwing from inside the step after the slices have settled. Is there a state where the
  hand-back loses spend accounting (the step's usage/ledger rows), or where the requeued window
  sees `stepIsDone` true and skips? Does a job that was *not* a first import (a real tree is
  already published) behave correctly when handed back mid-structure?
- C: is `job.requeues` the right thing to read, and can the step be told "a window is left" when
  `pauseForDeadline` would then refuse for an ordinary reason (not a race)?
- A: the narrow threshold (only a set whose own call would be refused). Is cutting at 2,033 and
  not at 61 defensible, or does it leave the realistic failure (a 500-leaf section whose one
  labels call fails) exactly where it was?
- A: `MIN_BATCH` merging and the "tail batch under the floor" pop-and-merge, with windows in play.
