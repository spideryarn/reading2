# Review: the ToC tiling stopped being checked and started being derived

You are reviewing code that has been written but not committed, in a repo you have reviewed twice
before on this exact subject (`260830ak-toc-repairs-and-heading-tree-review-sol.md`, and the stage-1
review whose findings 6 and 7 are cited in the code). Weight this review higher than a plan-stage
one: the plan and the code landed together, so nothing has already been vetted.

## The context you need

Stage 4 of the pipeline asks a model to carve an article into nested sections, each with a
`[startBlockId, endBlockId]` range over `blocks.json` **array order**. The tree must tile: every block
in exactly one leaf, in order, no gaps, no overlaps. Every downstream feature (granularity zoom,
scroll anchoring, comments, labels) addresses text by block id and assumes every block has exactly
one leaf.

The structure call is ~163 seconds and most of the stage's bill. A refusal therefore costs a reader
a whole article **after** the money is spent.

Two bounds were fitted and then overridden, each by a lost article:

1. A per-repair **size** bound of one block, removed 2026-08-30 (a 9-page arXiv PDF lost its ToC to a
   gap of three).
2. A per-answer **count** bound, `MAX_REPAIRED_BOUNDARIES = 1`, which you yourself argued for in the
   earlier review ("cap distinct repaired boundary coordinates per answer — initially one").

Both were fitted to the same four observations, all single slips, all from HTML articles with
headings. On 2026-08-31 a reader pasted a headingless PDF (a Princeton memory paper) and hit exactly
the gap the code comment had named as known and deliberate: two independent slips, one gap of a block
at depth two and one overlap of two at depth one.

Greg's instruction: *"This tiling issue is frequently an issue, and we need a clean, robust, general
solution."* And: *"Get something working that's simple, clean and robust, and also note in Appendix
and/or comments if you have a long-term-better plan. Ideally the stepping stone should be a step in
the right long-term-direction."* He explicitly chose to ship and watch the reported numbers rather
than buy an eval run first.

## What was built

`repairedChildRanges` (a cursor walk that believed each child's **end** and snapped the next child's
start up to meet it, subject to the two bounds) is replaced by `planChildRanges`, which **derives** a
tiling instead of checking one. For a parent `[P0, P1]`:

- the first kept child starts at `P0`;
- every later child starts where the model said, clamped into `[P0, P1]`, required to be strictly
  after the previous kept child's start — otherwise the child is **dropped**, with its subtree;
- every child ends one block before the next kept child's start; the last ends at `P1`.

Claim: gaps, overlaps, short last children and children running past their parent become
inexpressible, so `MAX_REPAIRED_BOUNDARIES` is deleted and nothing about the tiling can refuse an
answer. `assertChildrenPartition` is kept as the standing proof of totality.

Still refused: an unresolvable or backwards child range (which makes `planChildRanges` return `null`
for the whole sibling set, so the precise error survives), and a root that misses the article's ends.

Reporting: one `PartitionRepair` per boundary the model got wrong, with `size` = the distance between
the model's two claims about that boundary. Dropped children get their own count through
`BuildReport` → `HierarchyRun` → the CLI line → the pipeline log → the eval result.

## What I most want you to attack

1. **Is `planChildRanges` actually total?** Find any input where a derived node fails
   `assertChildrenPartition` or `checkTree`, or where a block gets zero leaves or two. Consider:
   `children.length === 1`; a parent that is a single block; every child sharing one start; starts
   clamped from beyond `P1`; the interaction between dropping a child and the `at`/`size` accounting;
   and whether `plans[child.at]` can ever be left `{keep:false}` for a child that should have been
   kept.
2. **Starts-authoritative vs ends-authoritative.** I claim a start is a claim the model has a reason
   for (heading, `sourceHeading`) and an end is a redundant restatement, so starts win. This reverses
   which section a gap's orphan joins. Is the argument sound? Is there a failure mode where believing
   starts is materially worse than believing ends — particularly on headingless PDFs?
3. **Dropping a child.** The old code refused this case on the grounds that emptying a child *deletes
   a section the model proposed*. I now drop it and count it. Is a separate `droppedChildren` figure
   enough, or does this need a refusal threshold of its own? Note that dropping discards the child's
   whole subtree, including any `sourceHeading` provenance.
4. **Did I remove a red path that was the vehicle for someone else's claim?** This is the mistake you
   caught last time (the eval silently stopped measuring the faults the repair mended). Three tests
   had encoded the old bounds and were re-pointed at faults that still throw. Check
   `evals/hierarchy-structure` in particular: does anything there still measure what it thinks it measures
   now that no tiling fault throws? Does `score.ts` have a measure that becomes necessarily-perfect?
5. **The `size` semantics changed** from "how far the boundary moved" to "how far apart the model's
   two claims about this boundary were". `repairedBlockCount` still deduplicates by `at` for
   cascades. Is that still coherent? Can two genuinely different boundaries now share an `at`?
6. **Is removing all tiling refusal the right call at all**, given Greg's instruction? If you think a
   guardrail is needed (I considered and rejected a proportional cap on blocks moved, on the grounds
   that it is a third un-evidenced threshold and firing it costs the reader the article this change
   exists to save), say what it should be and what evidence would set it.
7. **Anything logged or thrown that could contain article prose.** `where`, `kind`, `at` and `size`
   are meant to be derived from the answer's shape, never its content.

Also: is this genuinely a step toward the re-ask (feed the model back its own output with the
boundaries named, ask it to redraw), or a detour that will have to be undone? The plan argues the
re-ask needs both a fallback for when the second call is also wrong and a number to decide when a
second call is worth buying, and that this supplies both.

## Files

- `docs/plans/260831ai-hierarchy-tiling-normalisation.md` — the plan, written with the code.
- `docs/project/table-of-contents.md` § "The partition is derived, not checked".
- `src/toc.ts` — `planChildRanges`, `ChildPlan`, `BuildReport`, `PartitionRepair`, `buildTree`'s
  `visit`, `generateHierarchy`'s catch block and CLI line.
- `tests/hierarchy-repairs.test.ts` — rewritten, 25 cases.
The review was run against two `.diff` snapshots of the uncommitted working tree, which are not kept:
they were a second copy of the code with nothing to keep them in step, and the code they showed is
now in `569458f` (where it arrived as `src/hierarchy.ts` — the `toc` → `hierarchy` rename landed
underneath this work while the review was running). `git show 569458f -- src/hierarchy.ts` is the
same thing, and it is the copy that stays true.

Be concrete. Give me findings I can check, ranked, with the input that breaks each one.
