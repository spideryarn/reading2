# Stage D review: bounded headings fallback

Reviewed `e9abf4aa6836d8d53b4f9bdf4187fe9f27bd3324`, against the [stage D contract](261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md#stage-d-a-bounded-tree-with-no-model). Finding numbers continue the [plan review](261005a-long-documents-plan-review-sol.md). Changes from this review are uncommitted.

**Verdict: ship with the fixes made here.** F8 was an established structure regression and is fixed. F9 is a wider Arc feature limit for the implementer to decide; it does not prevent opening or reading the article.

## F8 — P1, established: a sound root-only tree with notes fails the new structure gate

**Input:** pass `generateStructure` one, two, three, four or 2,500 ordinary body paragraphs followed by a trailing footnote, with this model answer:

```json
{"root":{"title":"The piece","gist":"The piece says things.","question":"What follows?"}}
```

The real parser accepts it. `buildTree` grows body leaves directly under the root; `appendSupplement` adds an internal Notes child beside them. `assertTreeSound` accepts this composition. `planBatches` sees mixed children, recurses past every direct leaf and throws `planBatches left N of N gistable block(s) out of every batch`. Stage D introduced that planner call before returning the article; the preceding commit returned a readable article and failed later at labels.

**Fix:** exclude supplement nodes both from the planner traversal and from the child list used to identify a body leaf sibling set. Those nodes contain no structural blocks to label. This restores the body-only shape guarantee without broadening the planner to arbitrary mixed body siblings or swallowing its errors. Bodies of one to three blocks keep their model trees, avoiding the bounded builder's real four-block minimum. The 2,500-block body becomes a planned oversized labels call and takes the existing bounded fallback with its spend preserved.

**Evidence:** five regression tests were added before the fix and all failed at the new `unaskableBatches` gate with the missed-body message. They then passed. The permanent cases cover several supplement groups and a second run from the whole-document checkpoint. Existing rejection of an artificial mixed-body tree remains green in `tests/labels-batching.test.ts`.

Reproduce with `npx vitest run tests/structure-step-bounded-fallback.test.ts`. [Root cause and countermeasures](../postmortems/261005a-a-supplement-append-invalidates-a-labels-planner-assumption.md).

## F9 — P1, established, wider scope: Arc refuses 1,097 parts

**Input:** 1,097 h2 headings, each followed by two paragraphs of at least 20 words. Build the bounded tree, merge empty labels, then call `generateArc` with that article. Actual `generateStructure` takes `answer-too-long` with zero model calls; its tree has 1,097 parts. The tree passes `checkTree`; all 55 planned labels batches are askable; client geometry, 2,194 titled internal sections, outline and summary projections all work.

Actual `generateArc` refuses before network: `300 + 1097 * 80 + 40000 = 128060`, above the 128,000-token ceiling. 1,096 parts fits at 127,980; 450 parts fits at 76,300. This was exercised with the real Arc function, not just reconstructed arithmetic.

Owner arrival automatically requests Arc. The failed job means Structure's coarse list and Marginalia lack the Arc sentences. The Reader and other modes still mount; default ingestion does not depend on Arc completing.

**Smallest durable change:** generate Arc entries in bounded groups of parts, preserving each part's range and composing the results. Grouping depth-one parts in the bounded builder is a different product decision because it discards authored chapters as parts. Neither change belongs to this stage, so neither was made.

An offline reproduction script is `/tmp/stage-d-consumer-review.ts` (`node --import tsx /tmp/stage-d-consumer-review.ts`). To recreate it elsewhere, construct the sequence above, call `buildBoundedHeadingTree`, `mergeLabels`, and `generateArc({article: {slug, blocks, tree, meta: null}, power: "standard"})`; the refusal precedes the provider call.

## F10 — P3, established: inherited comments describe only the former model path

**Evidence:** `finishStructureRun` said `generateStructure` used only `buildTree` and that the merge preserved no heading labels. The new bounded path supplies authored heading labels before the empty-manifest merge removes them. A checkpoint comment also referred to `opts` above the helper, and the pipeline title comment implied a conditional read although the metadata read is unconditional.

**Fix:** describe the actual empty-manifest merge, name `generateStructure` as the checkpoint owner, and describe the eager metadata read for a possible fallback. These are prose changes, checked against the executable paths; no behavioural test was added for comment wording.

## Attacks that did not find another defect

The independent builder harness ran 9,817 sequences: exhaustive four- and five-block combinations of prose, short repeated prose, headings, empty headings and figures; uniform runs of eleven block kinds at lengths 4–100; and 5,000 seeded mixed sequences up to 253 blocks. Every case whose split body had at least four blocks passed the real builder, empty-label merge, `checkTree`, `planBatches`, labels budget, `buildGeometry` and `buildSections`. The only two refusals were inputs whose trailing supplement reduced the body below four blocks, the builder's documented precondition.

Permanent adversarial cases additionally cover heading-level jumps, a final heading, only empty/whitespace headings, only figures, only nonstructural text, only apparatus, stranded apparatus, small headed parts and several supplement groups. There were no empty section titles, paragraph sections, restated ranges or unaskable planned batches. Matching parent and child *titles* is not the restated-rung invariant; that invariant rejects matching whole ranges.

The two actual bounded triggers cannot reach a body under four blocks: the structure estimate requires hundreds of sections/blocks before refusing, and a labels answer refusal needs roughly two thousand structural blocks. F8 was a different planner failure, and is fixed at that composition seam rather than sent into an impossible bounded shape.

`buildHeadingTree`'s pinned digests pass unchanged. `finishStructureRun` checks/hashes the returned full block array and preserves whole-document and deepening spend. Splitting the blocks again in the bounded builder is redundant but deterministic; no mismatched array was found. Pipeline logs include both source values and both headings reasons. Metadata is eagerly read on every structure run; absence falls back through the builder's title choices. The read adds a store dependency but no established failure was found.

Input-size refusal, huge individual paragraphs, more than three label claims, Relations and stage E remain outside this review's fix scope. The result supports the structure/labels/navigation contract; it does not establish a universal successful-generation claim for every later AI feature, as F9 shows.

## Validation

Eight files passed, run individually: `bounded-heading-tree` (62), `structure-step-bounded-fallback` (10), `labels-batching` (95), `stated-limits` (5), `tree-provisional` (12), `supplement` (55), `structure-step-leaves-the-labels` (8) and `doc-links` (16): **263 tests**. The fallback file also exercises an actual deepening wave that leaves an unaskable child, checking whole-document, expansion and cache-token spend after replacement.

`node --import tsx scripts/typecheck.ts` passed all four projects and its source-coverage gate (3,042 source files). `npx biome lint` on the five touched TypeScript files returned zero with existing complexity advisories and the existing optional-chain warning. `git diff --check` passed. No network, Postgres, browser or full-suite run was attempted.

Files changed by this review: `src/labels.ts`, `src/structure.ts`, `src/pipeline.ts`, `tests/bounded-heading-tree.test.ts`, `tests/structure-step-bounded-fallback.test.ts`, this report, and `docs/postmortems/261005a-a-supplement-append-invalidates-a-labels-planner-assumption.md`. A separate edit to `docs/project/structure-step.md` appeared during the review and was left untouched.
