Verdict: **BLOCK**. The DTO and geometry fixes are correct. The sixth blocker is the scatter’s stale-point seam.

## Blocker: a supplement point is accepted and then mislabeled

[`dots()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scatter.ts:217) drops unknown block ids, but accepts any point whose id exists—even when the browser’s block is now a supplement. The article and projection are separate current-revision reads, so a re-ingest between them can produce a recognized id with changed classification.

That enters the fallback at [`scatter.ts:456`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scatter.ts:456). My probe with body/note/body blocks and points for all three produced:

```text
paragraph 1 of 2: row 0
paragraph 2 of 2: row 1   ← note
paragraph 2 of 2: row 2   ← real second paragraph
nowY: null
```

So the page simultaneously says the reader is not in the argument and draws the note as one of its paragraphs. With a trailing note it can say “paragraph 3 of 2”.

Standing on a note does not itself enter the fallback: `atRow` only controls `nowY`. The fallback becomes reachable when `input.points` contains a point resolving to a supplement block. Under a coherent same-revision response the server excludes those through `isEmbeddable`; stale or malformed-but-recognized input breaks that assumption.

The current test cannot catch it because it explicitly constructs points from `strandedBody`, excluding the note ([test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/scatter.test.ts:517)). `dots()` should reject `!isBody(block)` and the ordinal should then require a map hit rather than inventing one. Add a point for the stranded note and assert it produces no node.

## Seam inventory

The persistence/wire inventory is now closed, but one premise needed correcting: **Postgres blocks are not stored as one JSON document.** The tree is JSONB; blocks are explicit columns in `revision_blocks` ([schema](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:692)).

| Seam | Actual shape | Result |
|---|---|---|
| Filesystem artefacts | Full `Tree` and `{ blocks: Block[] }` via `ArtifactMap` | Safe; parsed and serialized whole |
| `src/store/contracts.ts` | `ArticleReader.loadArticle` returns the full `Article` | Safe; no projection there |
| Postgres tree | Whole `Tree` JSONB | Safe |
| Postgres full-block reads/writes | Column-by-column in `artifacts-pg.ts`, `pg.ts`, `pg-revisions.ts`, `import.ts`, and `export.ts` | Safe today; all carry `role`, `treatment`, and `noteId` |
| Narrow Postgres reads | Hashes select id/text/role/treatment; scalar reads select words/treatment; search deliberately ignores treatment | Safe and intentional |
| Public block path | SQL selection → `PublicBlock` → `publicBlock` | Safe; all three note fields cross |
| Public tree path | Whole JSONB → fieldwise [`publicTree`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:150) | Fixed |
| Cache fingerprints | `hashBlocks` and [`structureHash`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:188) | Safe; treatment is included |
| Browser offline cache | Stores the parsed response body as `unknown`, without reconstruction | Safe; no narrowing |
| Internal projections | Retain the original node/block or derive an explicit `supplement` flag | Safe |

I found no second field-by-field `TreeNode` transport boundary.

## Conditional spread

Yes, the spread launders a typo.

```ts
...(node.treatment === undefined ? {} : { treatmnt: node.treatment })
```

still satisfies the outer `TreeNode` assignment. Excess-property checking does not inspect extra keys contributed through a spread. An outer `satisfies TreeNode` does not repair that. A correctly spelled property with an incompatible value is checked; a misspelled property is merely an extra structural member.

This particular field is nevertheless protected by the exact recursive key-set test and the dedicated value assertion ([test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-dto.test.ts:352)). A compiler-level guard would require checking the inner fragment itself, for example with `satisfies Pick<TreeNode, "treatment">`.

## Empty-body geometry

`0` is the right defensive floor.

An all-apparatus article takes the fallback in [`splitBlocks`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/supplement.ts:114), gets no supplement node, and therefore does not produce an empty `bodyDepths` list. In a valid tree the root is also never inside `supplementIndex`, so at least its depth remains.

The empty case means a malformed tree with no nodes. No consumer divides by `leafDepth`; it is used as a column identifier or compared with depths. Returning `0` produces one depth-0 column, usually empty. Returning `1` would invent a nonexistent rung.

## Nits

Two test comments still describe the pre-fix state:

- [`tests/public-dto.test.ts:152`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-dto.test.ts:152) says `publicTree` does not copy treatment and calls the lane uncommitted.
- [`tests/public-dto.test.ts:282`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-dto.test.ts:282) still calls treatment “the absence to read”.

Focused verification passed: 109 tests across `public-dto`, `scatter`, and `supplement`. No files were changed.