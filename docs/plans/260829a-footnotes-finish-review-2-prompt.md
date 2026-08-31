# Second pass: the blocker you found, fixed

You reviewed this change and returned **BLOCK** on one finding
(`docs/plans/260829a-footnotes-finish-review-sol.md`). This is the fix. Please check the fix itself,
and look once more for anything the first pass and this one have both walked past — your
stage-4 review found eight and every one was real.

The regenerated scoped diff is `docs/plans/260829a-footnotes-finish.diff` (992 lines, was 799). You
were right that it was missing 53 lines: the Wikipedia regression test and the projection
test were both absent. It now carries every hunk, including the new `src/web/context.ts`
change below. Three files (`src/toc.ts`, `src/web/App.tsx`, `src/web/TableView.tsx`) are
still reconstructions of HEAD-plus-my-edits, because peers have uncommitted work in them.

## The blocker, reproduced before it was fixed

I built your shape rather than taking it on trust: `example/tree.json` deepened by one level
so `leafDepth` is 4 and the sections column is depth 3, one note appended.

```
checkTree problems: []          <- a completely valid tree
leafDepth: 4  sectionDepth: 3
navigableItems supplements: 1   [{ row: 34, continuation: true }]
fisheye supplements:        0
?at= sections named Notes:  1
```

Confirmed. And your diagnosis of *why* my property test missed it was exactly right and is
the part I want to record: it compared `navigableItems` against `buildSections`, and
`buildSections` is a thin wrapper over `navigableItems`, so the two agreed by construction.
It would have passed with the bug fully present. That is the same tautology you caught in the
hash compatibility test earlier the same day — twice in one change, both times a comparison
between a thing and a restatement of itself.

## The fix

`src/web/context.ts`, `itemsFromCells`: `if (item.continuation) continue;` becomes
`if (item.continuation && !item.supplement) continue;`, with the reasoning written next to
it.

The argument that this is safe rather than merely effective: the rule exists to keep a node
that is *already listed at a coarser column* from being listed again. A supplement item is
not that — `navigableItems` has already replaced the cell's node with the supplement node
itself, which appears nowhere else in this column, so there is nothing to repeat. `keynav`
and `buildSections` never filtered continuations at all, which is why they kept it and only
the fisheye lost it.

**Please check that argument rather than agree with it.** The case I cannot construct but
have not ruled out is a column where a supplement item's `startRow` collides with a real item
already emitted, which would give two entries anchored on one row.

## The tests

The property test is rewritten to compare **`itemsFromCells` against `buildSections`** — the
fisheye's own filter against the saved position — which is the seam the two can actually part
company at. Five shapes now, not three, and the topology varies as well as the count:

- one note, six notes, six references, all at depth 3
- one note and six notes under a **deeper body** (the broken shape), via a `deepen()` helper

Each asserts `checkTree(...).problems` is empty first, because the finding is that a *valid*
tree split the projections.

There is a second test as well, because the count on its own would not have caught what a
reader actually experiences: `currentIndex` reads the fisheye's own `starts`, so a dropped
supplement puts a reader standing mid-Notes in the last part of the argument. That is
asserted directly.

Both new deep-shape cases were watched go red against the unfixed code (`expected +0 to be 1`)
while the three shallow ones stayed green.

## State of the change

- `npm run typecheck`: all three projects pass. (Two `output/**` complaints remain — gitignored
  build artefacts a non-hermetic gate copies in; they are at HEAD and are not mine.)
- **Full `npm test`: 5576 passed, 306 files, zero failures.** The 19 failures I reported last
  time were peers' uncommitted work and have since cleared.

## What I want from this pass

1. **The continuation fix** — is `!item.supplement` the right exemption, or does it want to be
   narrower (say, only when the item's node is a supplement *root* rather than anything the
   supplement index maps)?
2. **Whether the deeper-tree shape breaks anything else in this feature** that I have not
   looked at. I checked the four projections and the arc; I did not re-check the spine or the
   summary tree against a depth-4 body with apparatus.
3. Anything else. Assume there is one more.
