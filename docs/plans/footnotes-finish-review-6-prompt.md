# Sixth and final pass: the DTO fix, and the seam question you opened

Your fifth review (`docs/plans/footnotes-finish-review-5-sol.md`) found the one thing five rounds
of owner-side testing could not: `publicTree` in `src/public/dto.ts` rebuilt a node field by field
and never named `treatment`, so a reader following a shared link got the entire footnotes feature
reverted. That was right, and it was the best find of the six.

This is the obligatory end-of-stage review of the fix for it. Both commits are now landed
(`6bc1021`, `dbe9e19`); the scoped diff of the second, which is the one no reviewer has seen, is
`docs/plans/footnotes-final.diff` (537 lines).

Every one of your five passes found a real blocker. Please assume there is a sixth and go looking
for it rather than confirming this one.

## What the diff does

**`src/public/dto.ts`** — `publicTree` now carries `treatment` through:

```ts
...(node.treatment === undefined ? {} : { treatment: node.treatment }),
```

Spread-when-present rather than an unconditional key, so a node without it serialises byte-identical
to before and no cached public payload changes shape. `tests/public-dto.test.ts` had a test
asserting the field is *dropped*, with a note saying whoever landed `TreeNode.treatment` would meet
it and decide; I flipped it and added `treatment` to the allow-list of fields that may cross.

**`src/web/tree.ts`** — `buildGeometry` took the depth ladder from the whole tree, so appending a
two-level apparatus to a one-level article changed the geometry of the argument. It now takes
`maxDepth` from the body nodes only, and exposes `supplementOf`.

**`src/web/scatter.ts`** — the spoken paragraph count ("paragraph 12 of 40") counted notes in its
denominator and could name a note as the reader's position. New helpers `bodyRows`, `bodyRowOf`,
`bodyOrdinals`, `lastBodyRow`; `nowY` is null when the reader is not in the body.

## What I want from this pass

1. **The seam question, generalised.** The DTO was a consumer nobody had listed because it is a
   *boundary*, not a projection. Are there other seams where a `TreeNode` or a `Block` is rebuilt
   field by field, or selected column by column, or serialised through a narrower type? Candidates
   I have looked at and believe are safe: `src/store/export.ts`, `src/store/contracts.ts`, the
   Postgres block/tree columns (both store the whole JSON document, not a field list). Check me,
   and name any I have missed. **Is the list closed this time?**

2. **The spread-when-present idiom.** `...(x === undefined ? {} : { k: x })` inside an object
   literal typed as `PublicTreeNode`. Does TypeScript's excess-property and optionality checking
   actually catch a typo in `k` here, or does the spread launder it? If it launders it, say so —
   that is the same class of silent drop one level down.

3. **`buildGeometry` with no body at all.** An article that is entirely apparatus falls back in
   `splitBlocks` and never gets a supplement node, so `bodyDepths` should never be empty in
   practice — but I default `maxDepth` to 0 when it is. Is 0 the right floor, or does some consumer
   divide by it?

4. **The paragraph ordinals.** `bodyOrdinals` builds a map from row index to a 1-based body
   ordinal. A reader standing on a note gets `?? d.row + 1` as a fallback label. Is that fallback
   reachable, and if it is, is it a lie?

5. Anything else. Sixth time lucky.
