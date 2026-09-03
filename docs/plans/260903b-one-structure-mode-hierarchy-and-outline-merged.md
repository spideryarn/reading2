# One structure mode: Hierarchy and Outline merged

**Status: proposal, 2026-09-03. Nothing built.** This is the thinking stage — Greg asked for
questions and proposals, not a build. There is an interactive mockup on real trees
(link under [The mockup](#the-mockup)), a GPT Sol design memo
([260903b-…-sol-design-memo.md](260903b-one-structure-mode-hierarchy-and-outline-merged-sol-design-memo.md)),
and a prior-art survey
([260903a-fisheye-hierarchy-ui-prior-art.md](../research/260903a-fisheye-hierarchy-ui-prior-art.md)).
The questions for Greg are at the [bottom](#questions-for-greg); the stages after them are
provisional until those are answered.

## What Greg asked for

Verbatim, 2026-09-03:

> I keep wondering if there's a way somehow to get the best of both worlds of Hierarchy and Outline
> in a single mode. […]
>
> For example, perhaps it dynamically adjusts based on the number of columns it's allowed. If
> allowed 1 column, it pretty much is Outline mode now..
>
> If allowed 2 or more columns, perhaps the first one is still something like the current Outline
> mode, but staying fairly high-level/coarse, and the second provides a fisheye with a narrower
> focus/purview somehow, e.g. another semantic fisheye with just the siblings and/or parents of the
> most granular current section. This multi-column should be a deterministic algorithm (rather than
> LLM).
>
> This isn't that far from what Hierarchy already does. The main differences I'm proposing:
> - I think the Outline mode is better if you only have a single column available. The
>   semantic-fisheye approach from Outline makes fuller use of all the vertical space (whereas the
>   currently Hierarchy columns often have big gaps).
> - Simplify the options/decisions that the user has to make, e.g. maybe it only shows either
>   1-column or 2-columns (whereas the current implementation asks the user to choose whether to
>   show L1, L2, L3, etc)? […] I'm thinking of column 1 as a wider-angle flatter fisheye, and
>   column 2 as more curved/narrower fisheye.
> - The current Hierarchy mode makes it a bit difficult to see which bits of one column relate to
>   another. In an ideal world we'd use some kind of visual indicator of how the bits in column 1
>   (especially for the active section) map to the bits in column 2 etc, kind of like a Sankey
>   diagram shows the fan-out/in from one column to another.
> - Move the Argument-Arc out into its own mode. (While you're doing that, add/update
>   docs/project/new-mode.md to provide a checklist for adding new modes, and/or nice reusable
>   machinery/templates/etc)
> - Also, it seems as though the current data structure is fixed at 3 levels. Is that right? I think
>   this needs to be adaptive, e.g. for a book (or really complex argument structure), say, we'd
>   almost certainly want at least 4 levels.
>
> These are just starting ideas - I'd welcome new ones!

## What is true today

Checked against the tree at `4b0163c9` and the corpus in `data/`, 2026-09-03.

- **The tree is fixed at three levels, and it is the prompt that fixes it.**
  [`src/hierarchy.ts`](../../src/hierarchy.ts) § `SYSTEM` says *"Go 3 levels deep: root (depth 0),
  chapters (depth 1), sections (depth 2)"*, and leaves are added mechanically one per block. All
  thirteen trees in `data/` are `maxDepth 3`. The branching-factor rule in the same prompt (5–9
  children) is blown wherever a fourth level would have been the answer: `constitution` has a part
  with **15** sections and sections with 23, 16, 15, 15, 13, 12 and 12 paragraphs; `noema` a
  section with 26. (The first draft of this plan said `scaling-hypothesis` had a part with 41
  sections. Sol checked: that node is the **Notes supplement**, 41 unlabelled leaves under one
  authored title, which the navigation projection already collapses to one item —
  [`tree.ts`](../../src/web/tree.ts) § `navigableItems`. The mockup's option label said the same
  wrong thing for an hour.)
- **The client is mostly depth-generic, but not all of it.** [`src/web/tree.ts`](../../src/web/tree.ts)
  builds one column per depth up to `leafDepth`, whatever that is, and
  [`position.ts`](../../src/web/position.ts) § `sectionDepth` follows it. What assumes three:
  [`outline.ts`](../../src/web/outline.ts) (`level` is 1/2/3 and the rung ladder is written for
  parts → sections → paragraphs), `columnLabel`/`columnPill` in `tree.ts` (depth 1 is "Parts", 2 is
  "Sections", the leaf is "Para"), [`Spine.tsx`](../../src/web/Spine.tsx) (depth 1 as bands, depth 2
  as ticks — reasonable at any depth, but it is a choice), and
  [`diagram.ts`](../../src/web/diagram.ts) § `MAX_DRAWN_DEPTH`. Stage 4's structure call cannot be
  split past ~1,976 blocks ([hierarchy.md § Longer pieces](../project/hierarchy.md#long-articles)),
  so a *book* is gated on that regardless of depth.
- **Hierarchy mode** is the `<table>` of [granularity-zoom.md](../project/granularity-zoom.md), with
  each gist column covered in reading mode by a fixed fisheye panel listing **the whole level**
  centred on the reader ([column-context.md](../project/column-context.md)). Three parallel lists
  at three resolutions; nothing drawn between a section and its part except a repeated title. The
  screenshots (2026-09-03, Noema, 1600px): the Argument column is nearly full; L1 and L2 are blank
  for their bottom third; L2's 21 sections sit under part headings, so belonging is readable but
  only by matching text across columns.
- **Outline mode** is one nested list in the band, the rung ladder of
  [260828aw-outline-mode.md](260828aw-outline-mode.md), never scrolling, measured to fit. At 1280
  on Noema it draws 5 parts + 6 sections + one gist and leaves the bottom **half** of the panel
  blank — "leftover space is left blank, and that is deliberate", and it is also exactly the gap
  Greg is describing. At 760 the band covers the prose entirely.
- **The arc** is a separate artefact (`arc.json`, stage 5b, [`src/arc.ts`](../../src/arc.ts))
  rendered in two places: the L0 "Arg" column of the table, and rung 4 of the outline.
- **What a mode costs to add** is measured in
  [260902o-adding-a-mode](260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md):
  11 client files for a simple one, and the registry that would make it fewer was weighed and
  refused. **The checklist Greg asked for already exists, in two halves:**
  [web-client.md § Adding a mode](../project/web-client.md#adding-a-mode) (the client) and
  [architecture.md § Adding an artefact-backed mode](../project/architecture.md#adding-an-artefact-backed-mode)
  (the pipeline and store). A `docs/project/new-mode.md` would be a third copy of the same list
  unless it is only a signpost to those two — see [question 8](#questions-for-greg).
- **A mode band is capped at 400px** — `MODE_IDEAL` in [`layout.ts`](../../src/web/layout.ts),
  shrinking to `MODE_MIN` 288 before the prose gives up a pixel. Two useful columns do not fit in
  that, so a second column for Outline is not the small change P6 below calls it: the new mode
  needs the width negotiation the Hierarchy columns get today, not the band's.

## The proposal

### P1. Miller columns with a degree-of-interest fill

Take the **focus path**: the block under the reading line, its section, its part, the root. The
**expanded outline** of that path is: for each ancestor, its children — every part; the current
part's sections; the current section's paragraphs. That is what Outline's rungs 1, 2 and 5 draw
today, and it is depth-generic: a four-deep tree simply has one more run of rows.

With N columns, **split the path's levels into N contiguous groups**; column *i*+1 is always the
expansion of the highlighted row in column *i*. That is the column view of the macOS Finder, with
the difference that a column never scrolls — it fills its height with fisheye density instead.

| columns | column 1 | column 2 | column 3 |
|---|---|---|---|
| 1 | parts › current part's sections › current section's paragraphs (Outline today) | | |
| 2 | parts › current part's sections, with gists | current section's paragraphs, tiered | |
| 3 | parts, all gists | current part's sections, gists | current section's paragraphs |

The split is chosen, not fixed: every contiguous split is fitted and the one whose columns climb
highest up their ladders wins, ties to the split that keeps more levels in column 1. So column 1 is
Greg's "wider-angle flatter fisheye" and the last column the "more curved" one, and neither is a
setting.

**Each column spends its height down a ladder**, as Outline does, measured against real rendered
rows and never estimated: titles → the current row's gist → wider tiers → the neighbours' gists →
every gist. Spare height stays blank only once the ladder is exhausted, which on Noema at 1280 it
is not — the mockup fills the panel Outline leaves half empty, with the same tree.

**The deepest level never truncates — it goes to ticks.** Outline's rule for a 26-paragraph
section is *all or nothing*, so it draws nothing. Here a row too far from the focus becomes a
6px hairline: the shape of the level stays whole, the readable window moves with the reader, and
a 23-paragraph section reads as a strip of ticks with a legible window in it rather than as a list
that runs off the panel. This is the part of the proposal that is new rather than a merge — and
Sol proposes a different answer to the same overflow, below.

### P2. The Sankey is one wedge per column boundary

Because column *i*+1 is the expansion of exactly one row of column *i*, the link between them is
a single trapezoid: the height of that row on the left, the full extent of the next column's rows
on the right. The same wedge runs from the spine's current band to column 1's current part group,
and there it is a genuine change of scale — proportional rail to equal-weight list. Nothing else
needs a ribbon; hovering a row lights its ancestor in the column to the left, which the table
already does.

### P3. No pills

Width decides the column count, the way [`layout.ts`](../../src/web/layout.ts) already decides
which gist columns fit; `Arg / L1 / L2 / Para` and `?cols=` go. A `?cols=` kept for testing is
the one exception worth considering.

### P4. Adaptive depth

Replace *"Go 3 levels deep"* with a branching-factor rule — keep splitting a node until it has
≤ ~9 children; a fourth or fifth level is expected on a long piece — and let `maxDepth` be
whatever comes out. Depth may be **uneven**: the 41-section part goes four deep while a
two-section part stays at three, which the partition invariant permits and
[`validate-tree.ts`](../../src/validate-tree.ts) already accepts. The client places named above
have to stop naming depths and start naming *"the level above the leaves"*. The mockup's
"synthetic 4th level" toggle splits over-long parts mechanically to show what the layout does with
one; it is not model output.

### P5. The arc becomes its own mode

"Argument": the arc sentences in the band, one per part, the current part's set large — and it
leaves the structure mode entirely (no L0 column, no rung 4). The `docs/project/new-mode.md`
checklist Greg asked for is written alongside it, from what
[260902o](260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md) measured.

### P6. Simplest first — revised

The first draft said the smallest delta was Outline growing a second column holding rungs 3–5,
with `outline.ts`'s `level` tags and `OutlinePanel`'s measured fit doing most of the work. Two
things were wrong with that: the band is capped at 400px, so the width has to come from the
Hierarchy columns' negotiation rather than the band's; and a rungs-1–2 / rungs-3–5 split gives
column B no sibling context and leaves column A carrying the churn, so it would test the wrong
design. The simplest *honest* version is the one under [Stages](#stages-provisional-sols-order):
parts in A, the current part's sections in B, Hierarchy untouched until the comparison is made and
deleted if the new thing wins — the outcome
[260828aw § Where it sits](260828aw-outline-mode.md#where-it-sits-and-what-happens-if-it-wins)
already anticipates.

## The mockup

<https://claude.ai/code/artifact/69da6300-8701-4b4d-94cb-5c28c8e60cf3> — the algorithm above,
running on the real trees of Noema, *The Scaling Hypothesis* and the Constitution, with the width,
height and column count as controls, the wedges switchable, and a synthetic fourth level. Scroll
the prose and the columns follow. It is not the client: the prose is trimmed, the spine is sized by
block count rather than pixels, the arc is absent on purpose. Source in this session's scratchpad;
worth moving under `experiments/` if it is used again.

## What the reviews said

### GPT Sol's design memo

[The memo](260903b-one-structure-mode-hierarchy-and-outline-merged-sol-design-memo.md), from
[this prompt](260903b-one-structure-mode-hierarchy-and-outline-merged-sol-design-prompt.md). Its
four factual claims about the code and the corpus were checked and all four held (the supplement,
the 400px band, the two existing checklists, the three-deep spine outline in `App.tsx`). Where it
changes the proposal:

- **Column 2 shows the current section's siblings with the current one expanded**, not only its
  children. Paragraphs alone answer "what is inside this section" and lose "which section am I in
  within this part" — the orientation problem the merge exists to solve. *Agreed*; the mockup does
  it the other way and should be read with that in mind.
- **The level split is fixed and left-stable — `[1][2…D]`, `[1][2][3…D]` — never rebalanced by
  fit.** "A theoretically better fit that changes what column B means at a part boundary is worse
  than a stable, slightly under-filled column." *Agreed*; the mockup's chosen-by-fit split is the
  thing it argues against, and column 1 with parts *and* sections in it is exactly where the
  branch churn lands.
- **A fixed-height focus well** per column: the current row and its detail live in a well whose
  outer height does not change, so crossing a boundary changes the well's contents and moves
  nothing below it. This is the answer to
  [260828aw § What actually moves](260828aw-outline-mode.md#what-actually-moves), and better than
  the mockup's.
- **Overflow: a centred window with explicit edge rows — "12 earlier", "9 later" — rather than
  ticks.** The two are the same shape with the far rows drawn as a count instead of hairlines;
  which reads better is for Greg ([question 3](#questions-for-greg)).
- **An outlined taper plus bracket, not a filled wedge**, one per boundary, in the parent depth's
  tint. The spine→column-1 taper is the informative one (a part's physical share to its one row).
- **Adaptive depth should be uneven**, and stage 4's rule should be: authored headings as
  boundaries, subdivide while a node has more than ~9 units, aim 4–9, no unary generated nodes,
  grouping nodes where many authored headings would make 15–40 siblings, a ceiling of six. What
  breaks first: `outline.ts` § the part/section walk, `position.ts` § `sectionDepth` on an uneven
  tree (a shallow branch becomes continuation cells at the "section" depth), `App.tsx` §
  `buildOutline(…, 3)`, `columnLabel`. The replacement abstraction is *focus path and next
  structural children*, never *the globally penultimate depth*.
- **Argument mode**: every arc sentence in order, the current one large, its part's title and
  gist beneath, its section titles as doors, and an established / here / still-ahead division
  derived from position. Not repeated inside Structure.
- **Name: Structure.** Outline names the flattened rendering, Map collides with Diagram, Contents
  sounds authored.
- **P6 is the wrong first step**, and not only because of the 400px band: a mechanical rungs-1–2 /
  rungs-3–5 split tests a design in which column B has no sibling context and column A carries
  the churn. Its v1 is Outline turned into experimental Structure with parts in A and the current
  part's sections in B, on today's three-deep trees, with Hierarchy kept for the comparison.
- **Four ideas not in the proposal**: separate *inspection* focus (hover retargets the columns
  without moving the prose) from *reading* focus; a quiet proportional hairline behind each
  equal-weight row, size only, never progress; carry the `§` authored-versus-generated mark into
  the rows; and treat a 15-sibling panel or a suppressed 23-paragraph list as a **stage-4 quality
  signal** worth recording, not only a layout problem.

### The prior-art survey

[260903a-fisheye-hierarchy-ui-prior-art.md](../research/260903a-fisheye-hierarchy-ui-prior-art.md).
Three things from it. Furnas's 1986 rule — `DOI(x) = importance(x) − distance(x, focus)`, show the
top-k — is what Outline's ladder and this plan's approximate by hand, and naming it would let one
function replace several thresholds. Miller columns (1980, via Smalltalk and NeXTSTEP to the
Finder) have no fisheye variant anywhere found; every column in every implementation is a plain
scrolling list. Ribbon connectors between levels exist (Parallel Sets, Parallel Hierarchies) but
always encode a quantity; no example was found of a constant-width link used for wayfinding
between two fisheye panels. The nearest LLM-era reader, TreeReader (2025), is one column of
expand-on-demand summaries over a paper's *authored* sections. Greg's belief that the combination
is unbuilt held up.

## Questions for Greg

Where I have a recommendation it is first.

1. **Column 2's purview.** Sol and I now both say: the current section's *siblings*, current one
   expanded — not only its children as the mockup draws. Your words, "just the siblings and/or
   parents", read that way too. Confirm?
2. **Split by fit, or fixed?** Sol: parts alone in column 1, always, and the rest in column 2 —
   stable over fit. The mockup rebalances and its column 1 sometimes carries the sections. I now
   agree with Sol; the mockup is the counter-example to look at.
3. **When a level will not fit**: a strip of hairline ticks with a readable window (the mockup),
   or a centred window with "12 earlier / 9 later" edge rows (Sol)? Both keep the level whole.
   Is either the progress hairline you removed, in another coat?
4. **Does the `<table>` survive?** `?text=0` — the compact whole-article contents table — is the
   one capability the band-based mode does not replace. Sol: let it go, and rebuild a "full
   contents" sheet from the Structure projection if it turns out to be missed. Do you use it?
5. **Inspect without moving.** Should hovering or first-tapping a row retarget the columns and
   connector while the prose stays put, with a second action to jump — or does every row jump, as
   today? Sol's idea; it costs two "current" states on screen.
6. **Depth: uneven** (a long part four deep beside a short one at three) is what Sol and I both
   recommend; uniform pads short parts with one-child nodes. Confirm?
7. **The arc's home.** Out of Structure entirely (Sol and I), or out *and* one line under the
   current part? And is Argument v1 orientation from the existing arc, or the fuller
   claims / support / omissions view — different artefacts, and Sol asks that they not be
   smuggled into one.
8. **`new-mode.md`.** The checklist exists in two halves already. Recommend a short
   `docs/project/new-mode.md` that is *only* a signpost to both plus the one thing neither says
   (the mode's URL params and dock row), rather than a third copy — or nothing, and a line in
   `reading-view-overview.md`. Which?
9. **The name.** Structure (Sol, and the mockup), or something else.

## Stages (provisional, Sol's order)

1. **Outline becomes experimental Structure.** Its arc rung goes; at widths that keep 544px of
   prose it gets a second column — parts in A, the current part's sections in B with the current
   section's gist and a capped paragraph expansion — with one connector, an automatic column
   count, the existing measured fit, and today's three-deep trees. This needs the Hierarchy
   columns' width negotiation, not the band's. Hierarchy stays for the comparison.
2. **Compare** on the Constitution, Noema, a short article, and narrow touch — in a browser, with
   the row-displacement measurement from 260828aw.
3. **If Structure wins, delete Hierarchy's presentation**: the pills, `?cols=`, the ContextPanels;
   `TableView` stays as the prose renderer until it is a one-column article, then becomes a block
   list. Decide `?text=0`.
4. **Argument mode**, the arc out of Structure, `new-mode.md` (or not) per question 8, and the
   Outline naming sweep from 260828aw.
5. **Structure goes focus-path-generic** — no absolute depth anywhere in the client.
6. **Adaptive, uneven depth** in stage 4, with a four-deep and an uneven fixture so the tests can
   exercise the arm ([silent-success.md](../reusable/silent-success.md)).
7. **A third automatic column**, and the full-contents sheet if it is missed.

## References

- [granularity-zoom.md](../project/granularity-zoom.md) — the tree, the table, the spine, the arc,
  and the fisheye sketch this is the descendant of.
- [column-context.md](../project/column-context.md) — the per-column fisheye panels Hierarchy
  draws today, and why the fisheye there is size rather than length.
- [260828aw-outline-mode.md](260828aw-outline-mode.md) — Outline: the rung ladder, the churn
  measurement, the corpus table, the name collision.
- [hierarchy.md](../project/hierarchy.md) — stage 4, the prompt, and why long pieces do not fit.
- [260902o-adding-a-mode](260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md)
  — what a mode costs and the registry that was refused.
- [`src/web/outline.ts`](../../src/web/outline.ts), [`OutlinePanel.tsx`](../../src/web/OutlinePanel.tsx),
  [`context.ts`](../../src/web/context.ts), [`layout.ts`](../../src/web/layout.ts),
  [`tree.ts`](../../src/web/tree.ts), [`src/hierarchy.ts`](../../src/hierarchy.ts),
  [`src/arc.ts`](../../src/arc.ts).
