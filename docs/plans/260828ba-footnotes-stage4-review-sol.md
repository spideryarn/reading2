Verdict: **BLOCK**. I found two blockers, plus several lower-severity correctness gaps.

## Blockers

1. **The whole-article summary prompt still presents the supplement as part of the argument.**

   [src/summarise.ts:432](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:432) builds the skeleton from every `root.children` entry. [src/summarise.ts:575](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:575) puts that skeleton into the automatic summary prompt.

   Concrete result for a tree ending in a supplement:

   ```text
   PART 3: Notes
     gist: (none)
   ```

   The note prose is correctly excluded by `textOf`, but the automatic model is still told that “Notes” is a part it should understand when producing the article summary. That violates “present in the structure, absent from the argument.”

   The prompt test at [tests/block-policy-prompts.test.ts:270](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/block-policy-prompts.test.ts:270) only plants a token in the note prose. It therefore passes while the supplement title and its apparent part status leak into the prompt.

   `skeletonOf` should use `partsOf(tree)` or explicitly exclude `isSupplementNode`.

2. **The stranded-apparatus fallback is silent in every normal output path.**

   [src/toc.ts:830](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:830) returns `strandedSupplement`, but:

   - [src/pipeline.ts:1150](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1150) omits it from both the server log and the job result.
   - [src/toc.ts:875](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:875) omits it from CLI output.
   - Nothing else consumes it.

   Concrete failure: body blocks followed by one note, another body block, then trailing notes cause `splitBlocks` to abandon grouping. Stage 4 publishes an ordinary legacy tree, reports normal success, and gives the operator no indication that the apparatus disappeared from the structure.

   Withholding the prose from model calls is correct, but it does not satisfy the structural feature. The count was meant to make that intentional fallback visible; currently it is swallowed.

## High severity

3. **The new root-summary match accepts unrelated tail edits.**

   [src/web/tree.ts:517](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:517) matches a root entry using only:

   ```ts
   entry.depth === 0 && entry.range[0] === currentRootStart
   ```

   Concrete failure:

   - Stored root summary covers `[firstBlock, oldLastBodyBlock]`.
   - A new ordinary paragraph is appended.
   - Current root covers `[firstBlock, newLastBodyBlock]`.
   - The old summary is still attached to the new root.

   I confirmed this directly: a summary written before the added body paragraph was returned as the current root summary.

   The existing stale-state banner reduces the damage, but the former “unmatched summaries are not moved” guarantee is lost. The match must prove that only a supplement changed the root end—for example, compare the stored end with the current last body block.

   The test at [tests/summarise.test.ts:433](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/summarise.test.ts:433) changes the root’s start, so it cannot catch a same-start body-tail change.

4. **The legacy `structureHash` framing collision remains reachable.**

   [src/source-hash.ts:157](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:157) uses JSON framing only when the tree contains a treatment. Every ordinary supplement-free tree still uses U+0000-delimited framing.

   I reproduced this exact collision:

   - Tree A: title `"A\0B"`, gist `"C"`
   - Tree B: title `"A"`, gist `"B\0C"`
   - All ids, ranges and parents identical

   Both produce:

   ```text
   62e6363900e131c6
   ```

   They are different JSON structures but have the same `structureHash`. Therefore labels or other derived data can be accepted against a changed tree.

   The supplemented JSON branch is fine. The problem is specifically that newly generated, non-supplemented trees continue to enter the ambiguous legacy branch. Preserving old hashes for today’s corpus needs to be separated from how future unsupplemented trees are framed.

5. **The six supplement invariants do not guard the direct stage-4 write.**

   After tree construction, [src/toc.ts:793](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:793) calls `checkCoverage`, then writes labels, blocks and the tree. It does not call `checkTree`.

   The only production `checkTree` call I found is in the Postgres revision path. The direct filesystem/CLI path can therefore write a tree where the supplement has a gist, is nested, has the wrong range, or swallows body blocks, provided ordinary label coverage still passes.

   The invariants themselves are useful, but an invariant that is not run before this write cannot catch a stage-4 regression.

## Medium severity

6. **A one-block supplement can defeat an invariant and split the shared projection.**

   [src/tree-invariants.ts:348](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:348) validates the supplement’s children, but does not require it to have any. A malformed one-block supplement represented directly as a leaf passes `checkTree` with no problems.

   I then passed that valid-as-far-as-the-checker-is-concerned tree through the projections:

   - Fisheye filtering at [src/web/context.ts:109](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/context.ts:109) drops the supplement because it becomes a continuation.
   - Saved-position sections include it.

   Result: the fisheye list contained only `Section`; position navigation contained `Section, Notes`. The four consumers share `navigableItems`, but they do not all apply the same continuation filter afterward.

   This also exposes a test assumption: existing supplement-shape tests use a multi-block apparatus produced by `appendSupplement`; they do not test whether the checker rejects a leaf supplement.

7. **Stage 5a loses the note identity when marking the return path.**

   [src/web/App.tsx:1692](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1692) stores only the passage block id. [src/web/notes-view.ts:290](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/notes-view.ts:290) then marks every backlink whose `href` points to that passage.

   Concrete failure: one paragraph cites notes A and B. Following A causes the backlinks for both A and B to receive `data-came-from`.

   I reproduced that exact result. The saved state needs both `fromBlockId` and `noteId`, and the backlink selector must constrain both.

   [tests/note-markers.test.ts:241](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/note-markers.test.ts:241) covers one note cited several times, not several notes cited by one passage.

8. **The import validator accepts footnotes that stage 5a cannot display.**

   [src/store/import.ts:292](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:292) requires a footnote to be a supplement, but does not require it to have `noteId`.

   [src/web/notes-view.ts:111](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/notes-view.ts:111) indexes only footnotes with a non-empty `noteId`.

   Therefore this passes import validation:

   ```ts
   {
     role: "footnote",
     treatment: "supplement",
     noteId: undefined
   }
   ```

   It is removed from the argument but absent from the note index, so its marker cannot open the range preview. The stage-3 decision to postpone the third cross-field implication is now stale because stage 5a depends on it.

## Things that are fine

- For an ordinary trailing apparatus, `generateToc` splits before tree and label model calls. Supplement prose does not reach those calls.
- The fallback renderer withholds supplement prose and retains only structural placeholders.
- `appendSupplement` produces the intended normal depth-one node and leaf ranges.
- The supplemented `structureHash` branch is unambiguous JSON framing.
- The shared projection is consistent for trees actually produced by the current `appendSupplement`.
- The stage-5a full-range preview, cloned-id removal and ordinary link handling look sound.

I could not run Vitest because this review environment is read-only: Vite failed before test discovery while trying to create `node_modules/.vite-temp/...`. I did run direct TypeScript probes for the summary leak, hash collision, stale root match, malformed supplement projection, and return-path collision; all reproduced as described.