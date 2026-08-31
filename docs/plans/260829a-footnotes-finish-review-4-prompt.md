# Fourth pass: diagram mode, fixed — and is there an eighth?

Your third review (`docs/plans/260829a-footnotes-finish-review-3-sol.md`) confirmed the summary fix and
returned BLOCK on diagram mode being the seventh projection. This is that fix.

Three passes, three real blockers, each one a projection nobody had checked. So the question I
actually want answered is not "is this fix right" but **"is the list of consumers now closed?"**
Please enumerate every consumer of the tree or the block list that could absorb the apparatus
into the argument, and say which of them are handled. If the answer is that seven is all of
them, say so explicitly — I would rather have that stated than inferred.

The regenerated scoped diff is `docs/plans/260829a-footnotes-finish.diff` (1615 lines). Three files
(`src/toc.ts`, `src/web/App.tsx`, `src/web/TableView.tsx`) are reconstructions of
HEAD-plus-my-edits, because peers hold uncommitted work in them.

## The fix

**`src/web/graph.ts`**, two changes:

- `walk(...).filter((e) => !e.node.supplement)` — filtered *after* `walk` rather than inside
  it, because `walk` is shared with the outline and the outline genuinely wants the supplement.
- the term loop skips `!isBody(b)`. Dropping the node alone is not enough, and this is the half
  I would have missed: an ancestor's range still spans the apparatus, and the root's always
  does, so the root would have gone on counting every note.

**`src/web/scatter.ts`**: the last dot's range stops at the last body block instead of
`blocks.length - 1`. The tiling comment already said what the tiling was *for* — a body
paragraph too short to embed, so the mark does not blink out — and the apparatus is not that
case, so a reader inside it now gets `-1`, which the caller already handles.

I confirmed your measurement rather than taking it: on a fixture whose notes contain one rare
word,

```
root top terms: zibbleflux, back, front, note, number, reads, nobody, artificial
```

— a word occurring only in the footnotes was the **top term for the whole article**.

## The tests

`tests/diagram-graph.test.ts` gets a fixture with a real supplement node and a note-only word,
plus:

- a **precondition** that the fixture actually has an apparatus and does contain that word,
  since otherwise every assertion below passes on an article that never had one;
- no node drawn for the apparatus;
- the word absent from every node's terms, root included;
- a **control** that the graph still describes the argument (`consciousness`, `cricket`),
  because "stopped counting any prose" would satisfy the first three while the picture went
  blank.

`tests/scatter.test.ts` asserts through what a reader sees rather than through an internal:
`here` only surfaces as Trail's chain brightness, so the test counts links at the top step.
With the bug, standing in the notes lit two of them; the control has a reader inside the
argument still lighting the chain around them. Both watched.

## State

- `npm run typecheck`: three projects pass; the two `output/**` complaints are gitignored build
  artefacts a non-hermetic gate copies in, present at HEAD, not mine.
- Full `npm test`: 5590 passed, 10 failed — all in `tests/store-jobs-parity.test.ts`, which
  **passes in isolation**, has a peer's uncommitted edits, and whose advisory lock exists to
  detect exactly this: another session running tests against the same local Postgres. I touch
  no jobs code.

## What I want

1. **The closed list.** Every consumer that could absorb the apparatus; which are handled.
2. Whether `!isBody(b)` in the term loop is the right predicate, or whether it should key on
   the supplement index instead — `isBody` is what the anchor edges in that file already use,
   which is why I chose it.
3. Whether stopping the last dot at the last body block breaks the tiling guarantee for the
   case it was written for, which is a short body paragraph with no embedding.
4. Anything else.
