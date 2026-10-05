# Code review: stage 1a, the slices survive a failed call

You are reviewing finished, uncommitted code, and you may fix what you find **inside this
stage**; anything wider, report and leave. Do not commit, and run no git command that changes
the tree or the index. Do not touch `src/web`, `src/types.ts`, or anything under `evals/results/`.
In `src/structure.ts` keep any edit to the slices call site and `StructureSource`: another
session is changing that file near `fromHeadings`.

## What it is for

A document too long for one structure answer is read in slices (`runSlices`,
`src/structure-slices.ts`). Before this change any failed call discarded every good slice and the
reader got a plain tree of the author's headings. The plan is
`docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md`
§ Stage 1a, with its read-only review `docs/plans/261005j-long-document-structure-plan-review-sol.md`
(F3, F4 and F5 are the constraints this stage was built under). The earlier work on this code,
whose fixes must not be reopened, is
`docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md`
(F15 to F18, F22 to F31).

## The change (`git diff HEAD`, plus two untracked files)

`src/structure-slices.ts`: (1) a failed refill keeps the section it was meant to divide; (2) a
slice whose answer is refused or cut short is read as two halves, with a marker saved under the
parent's checkpoint key so a later run asks the halves and not the refused parent; (3) one second
pass, inside the same run, over slices that failed for a reason another attempt could fix. The
single `stopped` flag became `outOfTime` and `gaveUp`, and every `ask` now carries a `need` of
`required`, `second-chance` or `optional`. `src/structure.ts` and `src/pipeline.ts`: `secondPass`
on the slices source and in the step's `detail`. Tests: `tests/structure-slices-second-pass.test.ts`
(new), and changed expectations in `tests/structure-step-slices.test.ts` and
`tests/structure-slices-adversarial.test.ts`. `evals/long-structure/fallback-arithmetic.ts` (new)
and one changed expectation in `evals/long-structure/dry.ts`. Docs:
`docs/project/structure-step.md`, the plan.

## What I most want attacked

1. **Sixteen existing test expectations were rewritten**, where the brief allowed one. For each,
   decide whether the old expectation encoded behaviour this stage deliberately reverses, or
   whether a real guarantee was weakened to make the suite pass. In particular the re-pinning of
   F26 ("a failed slice stops admission") and F17 ("waits for every call already started"), and
   the reversal of F28. Say which rewritten expectations you would restore.
2. **Splitting `stopped`.** Find any path where: a call starts after time has run out; a call
   starts after a final failure; a started call is not awaited before `runSlices` returns (its
   cost would then fall outside the step's ledger scope); usage is not counted for a refused,
   truncated or late answer; `spend.calls` double-counts or misses a transport attempt now that
   the OpenRouter seams re-ask a dropped connection themselves (commit `949fa80ba`); a reader's
   Stop becomes a fallback or triggers a retry.
3. **Halving.** Can a half vanish in the stitch (F15)? Is the new midpoint really among the seams
   `seamsHeld` checks at the call site? Is the marker's entry shape impossible to mistake for a
   stored answer, in both directions, including for a reader on older code? What happens to a
   marker when the blocks change, or when the halves later succeed? The builder chose: halves in
   sequence, not parallel; a heading cut only within a quarter-slice of the middle; no second pass
   and no marker for a refusal that cannot be halved. Are any of those wrong?
4. **The second pass.** It asks once with no validation re-ask; a final failure in it stops its
   peers. Can it run when its cap would not fit? Can a slice be asked in the second pass when its
   first-pass answer was accepted? Does `secondPass` count what it claims?
5. **A refill's own time cap no longer sets out-of-time.** Is the deadline still a bound, or does
   this let the step run past the queue's own deadline (F16)?
6. **Anything that reports success while doing nothing**: a test that would pass with the feature
   removed, a `secondPass` that is always zero, a marker that is written and never read.
7. `evals/long-structure/fallback-arithmetic.ts`: is the arithmetic right for what it says it
   assumes, and does the plan's table match its output?

## Gates you may run

`npm run typecheck` (or `node --import tsx scripts/typecheck.ts` if the wrapper fails in your
sandbox); `npx vitest run tests/structure-slices-second-pass.test.ts tests/structure-step-slices.test.ts
tests/structure-slices-adversarial.test.ts tests/stated-limits.test.ts` and any other slices test
file you find; not the whole suite. If vitest refuses to start for memory, say so plainly and
make no edit that needs a test you could not see red.

## What to return

A verdict (ship / ship with the fixes made / do not ship), findings numbered F1…, each with a
priority, established or reasoned, file and line, and whether you fixed it. List the files you
changed and whether your tests ran. Under 1,000 words.
