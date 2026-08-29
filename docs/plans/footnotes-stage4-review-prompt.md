# Review: footnotes stage 4 (the supplement node), and stage 5a

You are reviewing built code, not a plan. Weight this higher than a plan-stage
review: a plan review cannot find a handler that writes one field and then
rejects the request.

## What the feature is

An article's **apparatus** — endnotes, bibliography, acknowledgments — should be
**present in the structure and absent from the argument**. Greg, 2026-08-28:

> I feel there should be a way to see it in the structure of the doc (e.g. in
> the Spine, so that I could jump to the Footnotes), but we don't necessarily
> need to summarise and include it in the argument.

Two orthogonal axes were added to `Block` in stage 3:
`role?: "footnote" | "reference" | "acknowledgment" | "credit" | "appendix"`
and `treatment?: "supplement"`, plus `noteId?: string`. A note is a **range of
blocks**, not one block (gwern: 34 notes across 41 supplement blocks).

Stage 4 adds a **supplement node** to the tree: a depth-one child of the root,
authored title ("Notes"), deliberately **no gist**.

## Read these first

- `docs/plans/footnotes.md` — the plan, including "The invisible stage-4
  failure" and the stage-3 review you already gave.
- `docs/project/granularity-zoom.md` § The supplement node — the six invariants.
- `src/supplement.ts` — `splitBlocks`, `appendSupplement`, `supplementIndex`,
  `isSupplementNode`.
- `src/block-policy.ts` — the five named predicates that replaced a `gistable`
  overload. They are NOT five spellings of one formula.

## The diff

`git show 909db76` — attached as `footnotes-stage4.diff`. It is one commit
covering stage 4 plus two stage-3 follow-ups (the import validator's cross-field
rules, and word counts that say "not counting notes").

## What I most want you to attack

1. **The ordering claim.** `generateToc` splits blocks, builds the tree over the
   body alone, appends the supplement, and does all of that *before*
   `generateLabels` because `labels.json` stamps `structureHash`. Is there any
   path where a supplement block still reaches an automatic model call? Note
   `splitBlocks` gives up (returns no groups) when the apparatus is not one
   trailing run, and on that path `renderBlocks` withholds prose itself.

2. **`structureHash`'s legacy branch.** A tree with no supplement hashes byte
   for byte as before, so today's corpus is not invalidated. You found a real
   collision in `hashBlocks`'s v2 framing last time (U+0000 delimiters over
   model prose). The new supplemented branch is JSON-framed. Is the *unchanged*
   legacy branch still reachable in a way that now matters?

3. **The whole-article summary.** `buildSummaryTree` now matches the root by
   `depth === 0` **and** its start block id, rather than by range, because
   appending a supplement moves exactly one range — the root's end. Is that pair
   sufficient? Is there a shape where the wrong entry is chosen?

4. **The shared projection.** `navigableItems` (src/web/tree.ts) is used by the
   fisheye list, keynav, `?at=` (position.ts) and the arc's numbering. The claim
   is that all four must count the same items or the anchor invariant breaks.
   Check for a consumer that still counts raw cells.

5. **The six invariants** in `checkTree`/`checkSupplements`
   (src/tree-invariants.ts). The gist rule is stated in both directions on
   purpose: keyed on an absent gist alone, a pipeline bug that drops a gist is
   indistinguishable from a deliberate supplement. Is any invariant unfalsifiable
   — i.e. would it stay silent when defeated?

6. **Tests that share an assumption with the code they guard.** Two already bit
   us here: a fixture whose planted note sat two blocks past the renderer's
   context window (so the prompt test passed with the guard removed), and a
   single-block note where a real apparatus is a run. Look for more.

## Ground rules

- Name the file and line. Give a concrete failure: inputs or state → wrong
  output.
- Say plainly when something is fine. I will check each finding myself; some of
  your findings last time were wrong, and saying so cost nothing.
- Rank by severity and mark anything you consider a blocker.
