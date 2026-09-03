# Design memo: one Structure mode

## Recommendation

Replace Hierarchy and Outline with one mode called **Structure**, framed as **overview + scoped lenses**, not as a literal set of Miller columns. With one column it behaves like today’s Outline. With two, column A is the stable whole-article parts list; column B is the current part’s section siblings, with the current section expanded. With three, paragraphs move into their own column. Each boundary gets one restrained scope connector, not Sankey ribbons. Make column count automatic, keep it stable while scrolling, and use fixed-height focus wells so only their contents change. Move the arc to **Argument** and remove it entirely from Structure. Let trees be uneven and depth-adaptive, but do that after replacing the client’s absolute-depth assumptions. Once Structure wins the comparison, delete the Hierarchy columns, ContextPanels, depth pills, `?cols=`, and eventually the row-spanned table presentation.

## 1. The shape: keep Miller’s scope, reject literal Miller columns

P1 is directionally right: a column to the right should elaborate one selection to its left. But “partition the expanded outline” is the wrong visual model. It makes column membership an optimisation result rather than something the reader can predict.

Use this invariant instead:

> Every column begins with the siblings at its entry depth. Its selected sibling owns the detail shown beneath or within it. The next column is the selected sibling’s scope.

Column B should therefore show **the current section’s siblings, with the current section expanded**, not only its children. Paragraphs alone answer “what is inside this section?” but lose “which section am I inside this part?”—the very orientation problem the merged mode exists to solve.

The depth allocation is deliberately left-stable:

| Tree | 1 column | 2 columns | 3 columns |
|---|---|---|---|
| 3-deep: parts → sections → paragraphs | A: parts; current part expands to sections; current section may expand to paragraphs | A: all parts. B: current part’s sections; current section expands to paragraphs | A: parts. B: current part’s sections. C: current section’s paragraphs |
| 4-deep: parts → chapters → sections → paragraphs | A: the current branch expanded through all four levels | A: parts. B: chapters, with the current chapter expanded to sections and the current section optionally to paragraphs | A: parts. B: current part’s chapters. C: current chapter’s sections, with the current section optionally expanded to paragraphs |

General rule for `D` navigable depths and `N` columns: columns 1 through `N−1` receive one depth each; the last receives the remaining depths. Thus `[1…D]`, `[1][2…D]`, `[1][2][3…D]`. Do not rebalance this partition as focus moves: a theoretically better fit that changes what column B means at a part boundary is worse than a stable, slightly under-filled column.

This replaces P1’s proposed two-column split. Putting parts **and** sections in A makes the global column breathe, while B often becomes a context-free handful of paragraph labels. Parts-only A remains stable; all local change is contained in B.

One corpus correction matters: `scaling-hypothesis`’s 41-child node is actually the depth-1 **Notes supplement**, whose children are unlabeled leaves, not a body part with 41 sections (`data/scaling-hypothesis/tree.json`, node `n0189`). The shared navigation projection already collapses a supplement to one item ([tree.ts:180](../../src/web/tree.ts:180)). Treat 41 body sections as a future stress case, but do not optimise today’s UI around those notes.

## 2. Deterministic apportioning and height

Column count should depend only on viewport width, never the current branch:

- Preserve the 544px prose floor.
- Allocate one Structure column per 240px remaining.
- Clamp to 1–3 columns and to the number of navigable depths.
- On a covering narrow-screen band, always use one.
- Keep `?structure-cols=` only as a non-UI test override.

The existing generic band is capped at 400px, so P6 is not actually a tiny extension: two useful columns cannot fit inside it ([layout.ts:83](../../src/web/layout.ts:83), [layout.ts:363](../../src/web/layout.ts:363)). Structure needs a special core-reading negotiation, effectively inheriting the width currently available to Hierarchy columns.

Each column should have a fixed focus line and fixed-height **focus well**. One-line siblings sit above and below it; the well contains the current row and whatever further detail fits. Its ladder is:

1. Every sibling at the column’s entry depth, one line each.
2. The current item’s complete gist.
3. All children at the next assigned depth.
4. The current child’s complete gist.
5. Repeat 3–4 for further depths assigned to this column.
6. Paragraph `navLabel`s only when prose is beside the mode and there are at most eight.
7. Leave the remainder blank.

Measure candidate wells off-screen at the real width, as Outline already does, and choose the deepest candidate that fits; ties go to the lower honest rung ([OutlinePanel.tsx:100](../../src/web/OutlinePanel.tsx:100)). Never show half a child set—it falsely implies the node ends there.

The difference from current Outline is that the well’s outer height stays fixed. Crossing a section changes its contents but does not push every later part down the panel. Sibling rows keep one font size and one line; no distance-based rewrapping. Change only at structural boundaries, with a small hysteresis around the reading line and no height animation.

When the base sibling set itself does not fit, show a current-centred window plus explicit edge rows—“12 earlier”, “9 later”—rather than clipping invisibly. For a hypothetical 41-section body part, B becomes roughly 8–12 visible siblings around the current one plus those counters. For Constitution’s 15-section part, all section siblings should ordinarily fit; a 23-paragraph section does not expand because of the paragraph cap, but its gist and “23 paragraphs” count remain. The mode stays useful without inserting 23 rows and withdrawing them at the next boundary.

## 3. The link between columns

Do not draw Sankey ribbons. There is no flow quantity, and several ribbons would imply competing streams where the data contains simple containment.

Use one **scope connector** per boundary:

- A thin line leaves the selected row.
- It widens into a bracket spanning the next column’s content area.
- Hovering either side highlights the ancestor chain.
- The connector uses the parent depth’s tint, matching the successful grouped-band treatment already used in context lists ([column-context.md:325](../../docs/project/column-context.md:325)).

P2’s trapezoid contains a sound idea, but filling the whole gutter with a wedge will dominate the words. An outlined taper plus bracket communicates the same relation.

Between the proportional spine and equal-weight A, a taper is genuinely informative: it maps one part’s physical share of the article to its one-row entry. Between A and B it says “this row is the scope of that panel,” not “content flows this way.”

## 4. Adaptive depth

Replace “Go 3 levels deep” ([hierarchy.ts:121](../../src/hierarchy.ts:121)) with:

- Preserve authored headings as boundaries.
- Recursively subdivide while a node has more than nine structural blocks or more than nine meaningful child units.
- Aim for 4–9 children.
- Permit 2–3 where there is no honest further split.
- Introduce contiguous grouping nodes when many authored headings would otherwise create 15–40 siblings.
- Forbid unary generated nodes.
- Stop at a safety ceiling such as six internal depths.
- Emit no block leaves; the existing builder still attaches those beneath each terminal internal node ([hierarchy.ts:1098](../../src/hierarchy.ts:1098)).

Depth should be **uneven**. A short part should not receive invented subdivisions merely because a long part needs another level. The partition validator already requires parent/child depth agreement and exact tiling but does not require all leaves to share a depth ([tree-invariants.ts:201](../../src/tree-invariants.ts:201), [tree-invariants.ts:316](../../src/tree-invariants.ts:316)).

What breaks:

1. `outline.ts` explicitly finds `currentPart`, then `currentSection`, and emits levels 1/2/3 only ([outline.ts:190](../../src/web/outline.ts:190)).
2. Position tracking defines a section as global `leafDepth − 1`; on an uneven tree, a shallow branch becomes continuation cells at that depth and may be stored as a blank or paragraph-like “section” ([position.ts:47](../../src/web/position.ts:47)).
3. `App.tsx` builds the spine outline exactly three deep because it assumes the third level contains paragraph children ([App.tsx:1340](../../src/web/App.tsx:1340)).
4. `columnLabel` calls absolute depths 1 and 2 “Parts” and “Sections” ([tree.ts:210](../../src/web/tree.ts:210)).
5. Geometry itself is largely ready: it already computes maximum depth and continuation cells ([tree.ts:81](../../src/web/tree.ts:81)).
6. Key navigation is depth-generic and should mostly survive ([keynav.ts:152](../../src/web/keynav.ts:152)).
7. Diagram deliberately caps itself at depth 2, so it degrades safely rather than breaking ([diagram.ts:710](../../src/web/diagram.ts:710)).

The replacement abstraction should be “focus path and next structural children,” never “the globally penultimate depth.”

## 5. What to delete

If Structure wins, delete as reader-facing features:

- Hierarchy’s gist columns and fixed ContextPanels.
- `Arg / L1 / L2 / Para` pills and `?cols=`.
- The compact row-spanned `?text=0` table.
- Absolute depth names in the UI.

Greg loses exact same-y alignment between a gist boundary and its prose, arbitrary manual column combinations, the Para-beside-prose view, and the unique full-document paragraph outline. That is real.

But the normal reading view already covers the aligned cells with fixed panels; only a 10px boundary ruler remains visibly aligned, and the current title deliberately sits at the focus line rather than its prose start ([column-context.md:215](../../docs/project/column-context.md:215)). The founding table invariant is still valuable as data, but it is no longer the dominant experience.

Keep `TableView` temporarily as the prose/block renderer during migration. Once its only live use is a one-column article, replace it with a simpler block list. If the full paragraph outline proves indispensable, rebuild it as a “Full contents” sheet from the same Structure projection—not as a second row-spanned mode.

## 6. Argument

Agree with P5: the arc belongs only in **Argument**. Do not repeat one line inside Structure; that recreates ambiguity about whether a row describes containment or argumentative state.

Argument v1 should show:

- Every arc sentence in order.
- The current part large and unclamped.
- Its part title and gist beneath it.
- Its section titles as clickable doors to prose.
- A visible “established / here / still ahead” division derived from position, without generating new claims.

Later, if it earns the cost, evolve the artefact toward claims, support, objections, and omissions—the Argument view already named in the vision. Keep `arc.json` separate and range-joined as it is now ([arc.ts:27](../../src/arc.ts:27)).

Do not create a duplicate `new-mode.md` checklist. The client and artefact checklists now exist in [web-client.md:108](../../docs/project/web-client.md:108) and [architecture.md:342](../../docs/project/architecture.md:342), and the universal registry was deliberately refused. Extend those signposts for Argument.

## 7. Name

Use **Structure**.

“Outline” describes the flattened rendering, not the underlying relationship; “Map” collides conceptually with Diagram; “Contents” sounds like an ordinary authored ToC. Structure names the stable object across one, two, or three projections. Rename `buildOutline` to `buildSpineOutline` when doing the eventual collision sweep.

## 8. Ideas not yet in the proposal

**Separate reading focus from inspection focus.** Hovering or first-tapping a row could retarget the columns and connectors without moving the prose; activating it would jump. That would let readers inspect another branch while retaining their place. Cost: two simultaneous “current” states require extremely clear styling and careful touch/keyboard behavior.

**Put size inside equal-weight rows.** A quiet proportional hairline behind each sibling could show how much prose it covers while every sibling still gets one readable row. This imports the spine’s most useful property into Structure without sacrificing scanability. Cost: it may duplicate the spine and add exactly the peripheral motion/noise Greg disliked if progress is also encoded; size only, never live progress.

**Expose authored versus generated seams.** Carry the existing `§` provenance into Structure’s connector or row gutter, so the reader can distinguish the author’s organisation from the model’s proposed grouping. Cost: more chrome and a risk that readers interpret generated boundaries as low-confidence rather than simply machine-proposed.

**Use structural overflow as a quality signal.** A 41-sibling panel or repeated “23 paragraphs” suppression is not merely a layout problem; it says stage 4 failed its branching target. Record these cases and offer them to hierarchy evaluation. Cost: a feedback loop, corpus metrics, and possibly regenerating trees whose boundaries users have already learned.

## 9. Questions for Greg

1. Must every section in the current part be simultaneously visible, or is a centred window with explicit “N earlier/later” counters acceptable? This decides whether 41 siblings force scrolling or can remain a lens.
2. Is the all-article paragraph outline from `?text=0` something you actively use, or may Structure replace it? That is the only major capability deletion.
3. Should inspecting another branch leave the prose in place until a second action, or should every row immediately jump as today?
4. Is Argument meant to remain orientation from the existing arc, or become the fuller claim/support/omission view? Those are different artefacts and should not be smuggled into one implementation.

## 10. Simplest v1 and staging

V1: keep Hierarchy for comparison; turn existing Outline into experimental Structure; remove its arc rung; add a two-column layout at widths that preserve 544px of prose. A shows parts, B shows current-part sections with current-section gist and capped paragraph expansion. Use one connector, automatic column count, the existing measured-fit mechanism, and current three-deep trees.

The simpler option passed over is P6’s mechanical split—rungs 1–2 in A and 3–5 in B. It is less code, but B loses section-sibling context and A inherits the large branch churn, so it tests the wrong design.

Then:

1. Compare Structure against Hierarchy on Constitution, Noema, a short article, and narrow touch.
2. If Structure wins, delete Hierarchy’s presentation, pills, ContextPanels, and `?cols=`.
3. Move arc to Argument and resolve the Outline naming collision.
4. Make Structure focus-path-generic.
5. Change stage 4 to uneven adaptive depth and add deep/uneven fixtures.
6. Only then add a third automatic column and decide whether the compact full-contents sheet survives.