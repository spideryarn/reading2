# A later transformation invalidates a checked candidate

Review of [stage 1a](../plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md#stage-1a-try-again-by-itself-and-optional-calls-cannot-sink-the-tree-robust-the-simple-half)
on 2026-10-05 found two defects before commit or deployment. Nothing reached a reader. Both were
introduced by the uncommitted stage 1a candidate; there is no introducing commit. Earlier stage E
fixes did not introduce them.

## The class, named

**A later transformation invalidates a checked candidate.** The code treated an intermediate choice
as evidence about the final action. Selecting retries did not mean admitting their calls; selecting
a central heading did not mean the seam remained central after heading snapping.

In [runSlices](../../src/structure-slices.ts), `secondPass = again.length` counted proposed work
before cap-fit and terminal-failure checks. A blocked second pass reported one retry without making
one; ten failed slices reported ten retries when only eight were admitted. In `halvingCut`, heading
selection respected the central quarter, but unrestricted backward snapping could turn a 300-block
slice into requests of one and 299 blocks. A heading at the slice's start could also leave the cut
immediately after a heading.

## Why the checks missed it

Ordinary retry fixtures admitted every selected slice. Ordinary heading fixtures moved the seam
only slightly. They did not distinguish the candidate from the result of the later transformation.
Review added regressions in [structure-slices-second-pass.test.ts](../../tests/structure-slices-second-pass.test.ts)
and observed them fail before fixing the code.

## The lasting fix

Count a logical second-pass slice once, through a callback shared by its whole request and halves,
when a settled metered call reports positive transport attempts. Validate the snapped seam against
the central band; return `null` when no safe central seam exists. These local fixes also exclude
checkpoint-only work and avoid buying almost the refused parent again.

## Countermeasures, ranked

1. **Boundary regressions, added:** blocked admission, queued peers after final failure, and a long
   consecutive-heading run. Cheap fixtures distinguish planning from execution and normalization.
2. **Check the last representation:** when admission or normalization follows a check, assert the
   contract after that transformation. This review question costs little and applies beyond slices.
3. **A generic scheduling or normalization framework, rejected:** extra machinery would still need
   these boundary assertions. Neither defect requires replacing the existing coordinator.
