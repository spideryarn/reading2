# Fifth pass: the eighth consumer and the diagram denominators, fixed and committed

Your fourth review (`docs/plans/260829a-footnotes-finish-review-4-sol.md`) returned BLOCK on three
things and gave the closed-consumer inventory I asked for. All three are fixed. This work is
now committed as `6bc1021`; anything you find goes in a follow-up, so please be as hard on it
as the previous four passes, all of which found something real.

`git show 6bc1021` is the whole change (35 files). `docs/plans/260828o-footnotes.md` has the write-up.

## The three

**1. The eighth consumer — reader-facing counts.** `articleStats` (`src/web/stats.ts`) now
skips `supplementIndex` members when counting parts, sections **and depth**, which is exactly
what `deriveLibraryScalars` already did. Your probe's numbers reproduced: 3 parts and 2
sections where the article argues 2 and 1. The test lives beside the existing shelf/masthead
agreement test, since the two are one derivation with two implementations.

**2. Diagram scale.** `wordsBefore` now adds `0` for a non-body block, so `totalWords` is the
argument's length and Force divides body positions by a body total. In `scatter.ts`, Drift and
Trail take `bodyRows(blocks)` instead of `blocks.length` — that one denominator was being read
by three separate things, which is why your "paragraph 2 of 4" and the progress hue not
reaching the final step were the same bug. Drift's `nowY` is `null` when the reader is in the
apparatus rather than a line clamped to the bottom of the axis.

**3. The stranded shape.** You were right that a contiguous rule cannot describe a hole.
`bodyRowOf(blocks, at)` asks the block itself, and both Drift's `nowY` and Trail's `here` go
through it. There is a test placing a note *between* body paragraphs — the fallback
`splitBlocks` deliberately builds no supplement node for — and asserting Trail lights nothing.

## One bug of my own, which the suite caught

Putting `supplementIndex` on the masthead path put it on **every page load**, where a stored
tree whose root has no `children` array threw `Cannot read properties of undefined` and took
the reading view down. Twelve tests in `tests/article-rename.test.tsx` went red. `?? []` now,
with tests, because the rule everywhere else here is that a malformed tree renders visibly
short rather than throwing.

## Evidence

- Each of the three fixes was probed by reverting it alone; each reddened exactly its own test
  and nothing else.
- `npm run typecheck` at the commit, in a clean detached worktree: all three projects, 633
  files, zero errors — and the two `output/**` complaints that appear in the shared tree are
  absent there, confirming they are a working-tree artefact rather than a property of the
  commit.
- `npm test`: 5614 passing. Two files fail in the shared tree and both pass at the commit in a
  clean worktree — peers hold uncommitted edits in them.

## What I want

1. **Is the inventory closed now?** You listed thirteen consumer families and marked two as
   partial and one as unhandled. Please re-run that table against the commit and say whether
   every row is now handled — or name what is not.
2. **`bodyRows` as the denominator.** It is `lastBodyRow + 1`, so a stranded note in
   mid-article is still counted in it. That is deliberate — the axis has to be monotonic in
   row number — but tell me if it is wrong.
3. **`articleStats.depth`.** I excluded supplement nodes from the deepest-node calculation as
   well as from the counts, on the grounds that it answers "how many granularity columns can
   this article offer". Check that is right, and that nothing reads `depth` expecting the
   tree's true maximum.
4. Anything else.
