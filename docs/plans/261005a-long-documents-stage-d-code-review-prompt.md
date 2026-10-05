# Review: stage D, a document too long for one structure answer gets a tree from its headings

Repo: this worktree (`.claude/worktrees/long-documents-d-then-e`), branch
`worktree-long-documents-d-then-e`. TypeScript, ESM, vitest.

## The candidate

Committed: the head commit of this branch, titled "261005a stage D: …"
(`git log -1 --format=%H`). `git diff HEAD~1..HEAD`.
Changed paths: `src/heading-tree.ts`, `src/labels.ts`, `src/structure.ts`, `src/pipeline.ts`,
`tests/stated-limits.test.ts`, `tests/bounded-heading-tree.test.ts`,
`tests/structure-step-bounded-fallback.test.ts`, `tests/helpers/bounded-tree.ts`.

Start with: `src/heading-tree.ts` § `buildBoundedHeadingTree`; `src/structure.ts` §
`generateStructure` (the `try` around `wholeDocumentRequest`, `fromHeadings`, the `unaskableBatches`
check, `finishStructureRun`); `src/labels.ts` § `labelCallBudget`, `unaskableBatches`. This is where
to begin, not the limit of scope.

## What it is meant to do

The plan is
`docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md`
(§ The plan review, and what changed; § Stage D). Your own plan review is
`docs/plans/261005a-long-documents-plan-review-sol.md`; F1, F2 and F6 are implemented here, F3's
structure half was not (the implementer found no input-size estimate to reuse), F4 and F3's labels
half are deliberately not built.

The contract:

1. When `wholeDocumentRequest(body)` throws `TooLongForOnePass`, `generateStructure` returns a
   tree from `buildBoundedHeadingTree` rather than failing, with no model call.
2. That tree: passes `checkTree` with zero problems after `mergeLabels(tree, {})`, with or
   without a supplement; every body leaf at depth 3; no body sibling leaf set over `MAX_BATCH`;
   no internal node with an empty title; `provisional: "headings"`; its own version and generator,
   not overwritten with a model's name.
3. `planBatches` covers it completely and no planned batch is one the labels step would refuse.
4. The client's `buildGeometry` and `buildSections` over it give no empty-titled section and no
   section that is a paragraph.
5. A sound model tree (fresh, resumed from a checkpoint, or deepened) that holds a batch the
   labels step would refuse is replaced by the bounded tree, and what that attempt spent is still
   reported.
6. `buildHeadingTree`'s output is unchanged: it is the structure eval's control arm.
7. `StructureRun.source` says which path ran, and the pipeline logs it at every value.

The invariant to break: **after this commit no document fails at `structure` because of its
length, and the tree it gets is one the labels step can start on and every view can open.**

Out of scope: stage E; the cascade; a labels request bounded by characters; labels needing more
than three job claims.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage, each finding red-first with the test
that reproduces it, and leave everything wider as a finding for me to decide. Do not commit. List
every file you changed at the end. In any doc or comment you write, do not attribute words to
Greg and do not add dated quotations.

You can run one test file at a time (`npx vitest run tests/<one>.test.ts`) and a script
(`node --import tsx <script>`). You have no network, not even loopback, so anything needing
Postgres skips; I run those. Raw output I already have: the implementer ran 35 test files (870
tests) green, including `tests/bounded-heading-tree.test.ts`,
`tests/structure-step-bounded-fallback.test.ts`, `tests/stated-limits.test.ts`,
`tests/tree-provisional.test.ts`, `tests/structure-step-*.test.ts`, `tests/labels*.test.ts`;
`npm run typecheck` is green at this commit. The full suite has not been run yet.

## Attack it

Independently, before you read my questions below. Build adversarial block sequences and run the
real builder, `checkTree`, `planBatches`, `buildGeometry` and `buildSections` over them: headings
at odd levels, a heading as the last block, runs of headings with no prose, one-block parts, a
body of 1 to 5 blocks, all-figure windows, a document of only headings, supplements of several
groups, stranded supplement blocks, empty and whitespace heading text, blocks that are not
gistable or not structural.

For each finding give:
  - an ID continuing from the plan review (F8, F9, …), a severity, and established or reasoned
  - (a) the input or mutation I can run
  - (b) the fix you made, or for a wider finding the smallest change that closes it

P0: data loss, exploitable security, incorrect charging, or the service broadly unusable.
P1: user-visible wrong behaviour, or an authoritative contract violated.
P2: design or maintainability risk with no wrong behaviour today.
P3: non-behavioural prose or comment defect.

End with a verdict: ship, ship with the fixes you made, or do not ship. Refuse only on an
established P0 or P1 that you could not fix, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- `unaskableBatches` calls `planBatches`, which asserts coverage and throws. Before this commit a
  model tree that the planner could not cover published and then failed at labels, leaving a
  readable article; now the same tree would fail the structure step and there is no article. Can
  a tree that `buildTree` and `assertTreeSound` accept make `planBatches` throw? If so that throw
  should take the bounded path too.
- "A body under 4 blocks throws" in the bounded builder. Is that reachable from either trigger?
- The implementer cut a part with one sub-heading where `buildHeadingTree` wants two, and forces
  two windows on a part with no sub-headings. Any input where that yields a `checkTree` problem,
  a restated rung, or a section whose title equals its parent's in a way an invariant refuses?
- The synthetic dense paper (every heading the same level) comes out as 450 parts. Does any
  consumer of `partsOf` (`src/tree-parts.ts`) refuse or misbehave at that count? `src/arc.ts`
  budgets `300 + parts*80`.
- `finishStructureRun` was cut out of `generateStructure`'s tail; do its inherited comments still
  describe the code, and is anything computed twice or from the wrong block array?
- The pipeline now reads the extract meta for a title on every structure run.
