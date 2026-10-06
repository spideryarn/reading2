# Code review, stage A: the labels planner windows a section too long for one call

You are reviewing built code, and you may fix what you find, narrowly.

## The candidate

Commit `a8bc7b1ae` in this worktree (`git show a8bc7b1ae --stat`, `git show a8bc7b1ae -- src`).
Changed paths: `src/labels.ts`, `src/heading-tree.ts`, `src/structure.ts`,
`src/structure-slices.ts`, `src/pipeline.ts`, `evals/long-structure/arms.ts`,
`tests/labels-batching.test.ts`, `tests/structure-step-bounded-fallback.test.ts`,
`tests/structure-step-headings-first.test.ts`, `tests/structure-step-slices.test.ts`,
`docs/project/structure-step.md`, `docs/project/testing.md`. Start with `src/labels.ts`
(`planBatches`, `packSets`, `siblingSets`, `cutIntoWindows`, `windowsOf`, `canAskFor`,
`renderBatch`); that does not limit scope.

The plan: `docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md`,
"### Plan: the rest of stage 1a (2026-10-06)", stage A, and the review record after it (your own
plan review is `docs/plans/261005j-stage-1a-rest-plan-review-sol.md`; F1 is what this implements).

## Your edits, and their limits

**Another agent is editing `src/structure-slices.ts`, `src/structure.ts`, `src/pipeline.ts` and
`tests/structure-slices-*.test.ts` in this same tree while you work (stage B). Do not edit those
files, and ignore uncommitted changes in them.** You may edit `src/labels.ts`,
`src/heading-tree.ts`, `tests/labels-batching.test.ts`, `tests/structure-step-bounded-fallback.test.ts`
and the two docs. Fix what is inside stage A, red-first (write the failing test, see it fail,
then fix); report, do not fix, anything wider. Do not commit. Do not invent quotations from
anyone.

## Independent pass first

Attack it. In particular run things: `npx vitest run tests/labels-batching.test.ts` works with
no network or database (if it does not, say so; do not skip silently). Write your own probe of
`planBatches` over arrangements the tests do not cover and report what you ran.

Questions the code must answer:

1. Is there any tree for which `planBatches` (default `max`) returns an unaskable batch, loops
   for ever, drops or doubles a block, or returns sets out of document order?
2. Is a plan that was askable before this commit byte-identical after it (batches, `setStarts`,
   `span`, and so the checkpoint fingerprint)? The six-tree comparison in the tests copies the
   old planner: is the copy faithful to `a8bc7b1ae^`?
3. `cutIntoWindows` is now shared with the bounded headings tree: is the behaviour of
   `buildBoundedHeadingTree` unchanged in every case, `atLeast` included?
4. Does anything downstream mis-handle two sets with one `nodeId` in one batch or in adjacent
   batches: `renderBatch` (the new filter), the fingerprint, `runBatch`'s answer parsing and
   shift detection, the batch records, `mergeLabels`, the retry with doubled headroom?
5. With the two fallbacks removed from `generateStructure`, is there a path where a tree reaches
   the labels step and fails there, where before the reader would have had a headings tree?
6. Docs and comments: does any still describe the removed fallback or the old rule as current?

## Severity and verdict

P0 data loss, security, wrong charging, service unusable. P1 user-visible wrong behaviour or an
authoritative contract violated. P2 design or maintainability risk, no wrong behaviour today.
P3 prose. An ID on every finding (A1, A2, …), a severity, **established** (a run, or an exact
reachable path) or **reasoned**, and whether you fixed it. End with a verdict: land / land with
the fixes made / do not land, and the list of files you changed.

## My own suspicions, worth less than your pass

- The loop cuts only sets over `max` inside an unaskable batch. A batch unaskable purely by
  many small sets cannot exist (the packer closes at `max`), but check the tail merge after a
  windowed section: last window + a short tail.
- The builder noted, and did not fix, that a truncated batch is retried with doubled headroom,
  so a single-section batch of 1,742 to 2,032 leaves is askable once and its retry throws. That
  predates this commit. Is it inside this stage's promise or outside it?
