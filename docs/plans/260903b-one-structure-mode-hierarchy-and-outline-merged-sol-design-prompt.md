# Design consultation: one structure mode, merging Hierarchy and Outline

You are GPT Sol, consulted at the *thinking* stage, before any plan is written. This is not a
review of a plan. Greg (the product owner) has a set of rambling starting ideas about merging two
existing reading-view modes, and wants proposals, alternatives, and questions — including ideas he
has not had. Be concrete and opinionated; propose designs rather than listing considerations.

You have read access to the repo at the working directory. Read these first, in this order:

1. `docs/project/vision.md` — the principles (especially principle 1: generated text is a door, not
   a wall; never substitute a summary for prose that could be shown).
2. `docs/project/granularity-zoom.md` — the tree, the tabular view, the spine, the arc, the
   "too many levels" section, the fisheye sketch, and "what would make this fail".
3. `docs/project/column-context.md` § "What a gist column shows now" — how each Hierarchy column
   is today drawn as a fixed fisheye panel over the table.
4. `docs/plans/260828aw-outline-mode.md` — Outline mode: the rung ladder, "what actually moves",
   the corpus table, "where it sits, and what happens if it wins".
5. `src/web/outline.ts` (the outline projection), `src/web/context.ts` (the per-column fisheye),
   `src/web/layout.ts` (which columns fit at which width; `fitMode` for the band), `src/web/tree.ts`
   (geometry, `columnLabel`, `buildArcColumn`), `src/hierarchy.ts` lines 100–160 (the stage-4
   prompt, which fixes the tree at 3 levels), `src/arc.ts` (stage 5b, the arc).
6. `docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md` — what
   adding a mode costs today, and the registry that was refused.

The corpus: `data/*/tree.json` (13 trees). Measured today: every one is exactly `maxDepth 3`
(root, parts, sections, paragraph leaves). Largest fan-outs at depth 2: `scaling-hypothesis` has a
part with 41 sections, `constitution` 23, `noema` a section with 26 paragraphs. Parts per article:
2–9. Sections per article: 4–75.

## Greg's brief, verbatim (2026-09-03)

> I keep wondering if there's a way somehow to get the best of both worlds of Hierarchy and Outline
> in a single mode. Here are some rambling ideas to get us started on improving things.
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
>   show L1, L2, L3, etc)? In other words, if there's only room for 1 column, it's just like Outline
>   now. If there's room for more columns, then somehow it dynamically apportions the detail between
>   them. I'm thinking of column 1 as a wider-angle flatter fisheye, and column 2 as more
>   curved/narrower fisheye.
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

## My (Claude's) starting proposal — attack it, improve it, or replace it

**P1. The merged mode is Miller columns with a degree-of-interest fill.** Take the *focus path*
(root → part → section → … → the block under the reading line). An "expanded outline" of that path
is: for every ancestor on the path, its children, one row each — which is exactly what Outline's
rungs 1, 2 and 5 draw today. With N columns, partition the path's levels into N contiguous groups;
column i draws the expanded-outline rows for its group, so **each column is the expansion of the
highlighted row in the column to its left** (macOS Finder's column view, but every column fills its
height with fisheye density instead of scrolling). N=1 is Outline today. N=2 on a 3-deep tree:
column A = all parts + the current part's sections; column B = the current section's gist + its
paragraphs (navLabels) — and, if room, the neighbouring sections' first lines. Spare height in a
column is spent down a ladder, as Outline does (a gist on the current row, then gists on the near
siblings, then …), and leftover space stays blank. Deterministic, depth-generic.

**P2. The "Sankey" is one wedge per column boundary.** Because column B is always the expansion of
exactly one row of A, the link is a single trapezoid from that row's height at A's right edge to
B's full height at its left edge — the lens, drawn. The same wedge can run from the spine's current
band to column A's current-part group. Hover a row in B → its ancestor row in A lights (the table
already does this along the ancestor path).

**P3. No pills.** Width decides the column count (`layout.ts` already does this arithmetic for the
table); the L0/L1/L2/Para toggles and `?cols=` go. Possibly one `?cols=` kept for testing only.

**P4. Adaptive depth.** The stage-4 prompt says "Go 3 levels deep". Replace with a branching-factor
rule ("keep splitting a node until it has ≤ ~9 children; a 4th or 5th level is expected on long
pieces"). The client geometry (`tree.ts`) is already depth-generic; `outline.ts` hard-codes
`level` 1/2/3; `columnLabel` names depths "Parts"/"Sections"; the spine draws depth 1 as bands and
depth 2 as ticks. Note that stage 4's structure call cannot be split for pieces past ~1,976 blocks
(hierarchy.md § Longer pieces), so a *book* is gated on that regardless.

**P5. The arc becomes its own mode ("Argument"):** the arc sentences as a list in the band, the
current part's set large, and it leaves the structure mode entirely (no L0 column, no rung 4).

**P6. Simplest v1** — the smallest delta from today's code: Outline mode grows a second column at
wide widths, holding rungs 3–5 (the current section's sentence and paragraphs) so column one can
keep rungs 1–2 for the whole article; `outline.ts` already tags rows with `level`, and
`OutlinePanel` already measures candidates to fit. Hierarchy mode is left alone until the
comparison has been made, then deleted if the new thing wins.

## What I want from you

1. **Design.** Given the corpus numbers, does the Miller-columns-with-DOI-fill framing hold, or is
   there a better one? In particular: should column B show *only* the current section's children
   (Miller), or the current section's *siblings with the current one expanded* (a second, narrower
   fisheye — Greg's words are "just the siblings and/or parents of the most granular current
   section")? Which reads better on a 41-section part? Be specific about what each column draws for
   N=1, 2, 3 on a 3-deep and a 4-deep tree.
2. **The apportioning algorithm.** Propose a concrete, deterministic rule for splitting the focus
   path's levels across N columns and for spending spare height, including how it degrades on
   `scaling-hypothesis` (41 sections) and `constitution` (15-section part, 360 leaves), and how it
   avoids the churn `260828aw` § "What actually moves" measures. State the ladder per column.
3. **The link between columns.** Wedge vs. Sankey ribbons vs. brackets vs. simple highlighting:
   what actually helps and what is decoration? Consider that the spine is *proportional* and the
   columns are *equal-weight*, so the wedge from the spine is a genuine change of scale.
4. **Adaptive depth.** How should stage 4 decide depth? What in the client is silently assuming 3
   (grep for it — `outline.ts`, `position.ts`, `Spine.tsx`, `columnLabel`, `keynav.ts`,
   `diagram.ts`) and what would break first? Should depth be a property of the tree (uneven — a
   long part goes 4 deep, a short one stays 3) or uniform across the article? The partition
   invariant and `validate-tree.ts` constrain the answer.
5. **What to drop.** Does the `<table>` (TableView, rowSpan alignment, `?text=0` compact table)
   survive, or does the band-based mode replace it? What would Greg lose? The alignment invariant
   was the founding idea of the tabular view — but the fixed ContextPanels already cover the cells
   in reading mode. Say plainly what you would delete.
6. **The arc's new home.** Own mode, a line inside the structure mode, or both? What would the
   Argument mode show beyond the list of sentences?
7. **The name** of the merged mode (Outline? Structure? Map? Contents?), noting the existing
   name collision documented in `260828aw` § "A name collision to settle".
8. **Ideas Greg hasn't had.** At least three, each one paragraph, each honest about its cost.
9. **Questions for Greg** — the ones whose answers would change the design, not the ones we can
   settle ourselves.
10. **The simplest v1**, and what you'd stage after it. Name the simpler option you passed over.

Write it as a design memo, headed, under ~2,500 words, with a one-paragraph recommendation at the
top. Where you disagree with P1–P6, say so and say why. Where you make a claim about the code, cite
the file and line.
