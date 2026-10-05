# Plan review: long-document structure, top level first

You are reviewing a plan before anything is built. Read-only: do not edit any file.

## What to read

- The plan: `docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md`
- What exists: `src/structure-slices.ts` (all of it), the slices call site in `src/structure.ts`
  (`generateStructure`, from `wholeDocumentRequest(body)` to the `source: { by: "slices" … }`
  return), `src/heading-tree.ts` § `buildBoundedHeadingTree`, `src/tree-invariants.ts` § the gist
  rule, `src/types.ts` § `Tree.provisional` and `TreeNode`, `src/web/position.ts` §
  `sectionDepth`, `src/labels.ts` § `unaskableBatches` and the batch planner.
- Background: `docs/project/structure-step.md` § When one answer will not fit;
  `docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md`
  (its reviews F1, F15 to F18 and F28 matter here); `docs/plans/260904c-hierarchy-structure-in-waves.md`.
- The measurement script: `evals/long-structure/measure-today.ts`.

## What the plan claims, to be checked against the code and not taken from the prose

1. `runSlices` is all or nothing: one failed call discards every slice.
2. A refused or cut-short answer is not asked again.
3. A failed refill, a failed root call, or one section the labels step cannot ask about each
   give the whole document the headings tree.
4. Slices start on the bounded headings tree's boundaries, so a failed slice's stretch is whole
   nodes of that tree and they can stand in for it.
5. Every consumer of a gist already reads it conditionally.

## What I most want attacked

- **Stage 1's mixed tree.** 261005a's review insisted D's windows never be mixed into a model
  tree, and gave `sectionDepth` as the reason (the client takes one section level for the whole
  article). Stage 1 mixes them per slice. Is that safe given the bounded tree puts every block at
  depth 3 and a model slice may put paragraphs at depth 2? What exactly breaks, and what is the
  smallest rule that makes a mixed tree sound? Is a per-node mark right, or is there a simpler
  carrier? What besides `checkTree` has to learn it (the publish guard, the labels step, the
  public DTO, any hash)?
- **Halving a truncated slice**, and making refill, root and labels failures non-fatal: any way
  these produce a tree that passes the checks and is wrong, in the manner of F15 (a slice that
  vanished in the stitch)?
- **The spend and deadline rules** F16 and F17 fixed: does "keep what arrived" reopen either?
- **The eval design**: are arms A, B and C the right three, is the corpus enough, are the bars for
  choosing B or C sensible, and is anything measured in a way that cannot fail (a check that would
  pass whatever the arm did)? Is the hypothesis that C will not pay stated fairly?
- **Order**: should stage 1 wait for the eval? Is there a simpler route to "robust" that the plan
  passed over without naming?
- Anything in the plan that is stated as fact and is not true of the code.

## What to return

A verdict (build as planned / build with changes / do not build), then findings numbered F1…,
each with a priority (P0 to P3), whether it is established from the code or reasoned, the file and
line, and the change you would make. Say plainly which claims above you checked and found true.
Keep it under 1,200 words.
