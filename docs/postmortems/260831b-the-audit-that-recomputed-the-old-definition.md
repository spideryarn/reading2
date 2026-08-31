# The audit that recomputed the old definition

**2026-08-31.** `tests/store-shelf-reads.test.ts` exists so that a denormalised column which is
*present and wrong* cannot hide: it reads every published revision's stored scalars and recomputes
them from the blocks. It reported `scaling-hypothesis` as wrong — stored 12,646 words against an
actual 16,855, with `blockCount`, `partCount`, `sectionCount` and `rootGist` matching exactly.

The column was right. The audit was wrong, and had been for three days.

## What was actually broken

`wordCount` became **body** words on 2026-08-28 — the rule is
[`countsTowardReadingTime`](../../src/block-policy.ts), which is `treatment !== "supplement"`. The
audit's projection selected `words` alone:

```ts
.select({ words: revisionBlocks.words })
```

`Treated` is `{ treatment?: Block["treatment"] | null }`. A row without the field satisfies it, so
every block arrived `undefined`, every block read as body, and the audit recomputed the **total** —
the definition `wordCount` had *before* 2026-08-28. 16,855 is the total, 12,646 is the body, and the
1.33× gap is gwern's 41 endnote and bibliography blocks.

Both writers — `src/store/import.ts` and `publishRevision` in
[`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) — call `deriveLibraryScalars` on
blocks that carry `treatment`, and agree with each other and with `blocks.json` on disk. **Nothing in
`src/` computes 16,855.** Only the test did.

`01b55b2` (17:16) made the change; the projection was written earlier the same day in `b688fc6`
(02:11) and never revisited.

## Why nothing reported it

Three guards, and each one was blind for its own reason.

- **The type cannot object.** `Treated`'s field is optional, so omitting it compiles clean. A weak
  target tests for having nothing in common, not for having the field — and no typecheck can redden it.
- **The fixture could not redden it.** Until 2026-08-31 the local database held exactly one
  non-`test-` article, and it had **zero** supplement blocks. So `stored` and `actual` agreed by
  having nothing to disagree about. The assertion ran on every suite run, passed every time, and
  never once exercised the axis it is about.
- **The warning existed and pointed one file away.** [`src/store/pg.ts`](../../src/store/pg.ts) §
  the shelf's fallback says, in almost these words, that a shape carrying `words` alone would make it
  the one place still counting the bibliography. It was written about the fallback. This is the same
  substitution in the audit that was supposed to check the fallback.

## How it surfaced

Not by being looked for. A stray `data/orphan-test/` directory was killing `store-parity`'s and
`store-roundtrip`'s `beforeAll`; deleting it let both suites run, which imported the whole `data/`
corpus, which put **the first article with footnotes** into the current-revision set. The deletion
wrote no wrong value — it supplied the first fixture capable of reddening a wrong test.

## The fix

`treatment` is in the projection, with the cast the column's `text` type requires and
`revision_blocks_treatment` in [`src/db/schema.ts`](../../src/db/schema.ts) as the CHECK that makes
it sound — the same cast [`src/store/pg.ts`](../../src/store/pg.ts) makes for the same reason.

**Checked it can fail:** forcing `treatment` to `null` in the mapped row reproduces 12,646 against
16,855 on the same slug; restoring it returns 10/10.

## What would have caught the class

Not a better projection — the next one will make the same omission, because the type permits it.

- **The fixture set is the real hole.** This audit's power depends on what happens to be in a
  developer's gitignored `data/`. `data/consciousness` (276 supplement blocks) and
  `data/spaced-repetition` (73) are on disk and skipped only because they lack `tree.json`. An audit
  whose reddening depends on which articles a laptop happens to hold is not a gate — GPT Sol's
  general form of this, about `completeArticles()`, is in
  [260831e-tree-sweep-2026-08-31-review-sol.md](../plans/260831e-tree-sweep-2026-08-31-review-sol.md) § Claim 3. **A
  tracked fixture with a supplement block would have made this red on the day it was introduced.**
- **A required field beats an optional one.** If the recomputation took
  `Pick<Block, "words" | "treatment">` rather than `Treated`, the omission would not compile. That is
  a change to a shared type and worth weighing, but it is the only fix here that a machine enforces.
- **Grepping for the wording is not checking the claim.** The same day and the same tree produced
  [260831a-the-scroller-that-mounted-after-the-measure.md](260831a-the-scroller-that-mounted-after-the-measure.md)'s
  sibling failure: two agents confirmed a false claim had been *removed* rather than that its
  replacement was *true*, three times running, and only a measurement settled it.
