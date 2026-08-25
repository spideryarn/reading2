# Column context: four experiments, side by side

**Status:** built and then decided, 2026-08-25. All four were built as toggles, compared, and
Greg chose Centred as the only one — *"Let's make Centred always-on, and get rid of Siblings,
Neighbours, and Panel."* What survives, and what the three dropped modes taught, is in
[column-context.md](../project/column-context.md); this is the plan and the reasoning as they stood
before the code, kept so the *why* survives. Two things the build changed: continuation cells are
not items (GPT's code review — they broke the sibling-run assumption on an unbalanced tree), and the
in-cell modes do not keep the current title at its cell's top edge, as claimed below — the earlier
siblings, or the previous title, sit above it.

## The problem

> The main issue at the moment is that the middle/non-text columns aren't very information dense. In
> some ways I appreciate that they show where I am and only that, because it's nice and clean. But
> at the same time, it means that I can't really scan with my eyes up and down in any of those
> columns to understand what came before or where this is situated or anything like that.
>
> So I'm wondering if each column could somehow be a fisheye that shows what came before and what
> after … I suppose one approach would be to always have the current cell centred and then to show
> stuff above and below smaller.
>
> — Greg, 2026-08-25

Mid-article, the L0 and L1 columns are roughly 80% empty: a spanning cell's sticky gist sits at the
top and the rest of the cell is blank until the next part begins, thousands of pixels down. The
column tells you *where you are* and nothing about what came before or what is coming.

> can we implement this as extra column(s) that we can hide/show, to experiment with? … better
> still, try implementing it multiple ways, with buttons to toggle them on/off so we can play with
> and compare various ideas. For each one, add a rich tooltip to the button explaining the
> working/intent/research.
>
> — Greg, 2026-08-25

## What the research said

Two Sonnet agents searched on 2026-08-25. The findings that shaped the design:

- **People don't read a shrunk periphery.** Hornbæk & Hertzum's eye-tracking study of fisheye menus
  ([TOCHI 2007](https://www.kasperhornbaek.dk/papers/TOCHI2007_FisheyeMenus.pdf)) found participants
  barely looked at the compressed region, and fisheye menus were *slower* than plain hierarchical
  ones for known-item search. Shrunk text works as a landmark, not as content.
- **Discrete tiers, not continuous scaling.** Continuous fisheyes (Bostock's D3 fisheye, the Dock,
  Table Lens) work for icons and numbers, which survive compression; sentences hit a
  just-legible/illegible dead zone. Furnas's own DOI treatment
  ([1986](https://cspages.ucalgary.ca/~saul/581/exer.eps/4furnas86.pdf)) was omission and
  truncation, not tiny type.
- **Focus follows scroll, never the pointer.** Pointer-driven fisheyes reflow under the mouse; the
  existing fisheye sketch in [granularity-zoom.md](../project/granularity-zoom.md#the-other-view-fisheye)
  already warned about the feedback loop. Reading position is stable.
- **"Whole list, current one highlighted" tested best.** Wikipedia's 2023
  [sticky-ToC user testing](https://www.mediawiki.org/wiki/Reading/Web/Desktop_Improvements/Repository/Sticky_Header_and_Table_of_Contents_User_Testing)
  had the persistent full outline with the current section bolded beat every floating or collapsing
  variant, in every group tested.
- **Cap it.** [VS Code's Sticky Scroll](https://devblogs.microsoft.com/visualstudio/sticky-scroll-stay-in-the-right-context/)
  pins ~5 lines at most, and users asked for a choice of whether inner or outer scope wins when there
  isn't room for both.
- **Distance in the tree beats distance in pixels.** Furnas's DOI needs an a-priori importance to
  combine with distance, and the outline's levels supply one for free — siblings within a parent are
  "near", cousins are "far".

## The four modes, and a fifth toggle

All five are URL state (`?ctx=`, `?prog=1`), push history like `cols`, and default to off, so the
view is unchanged until a pill is pressed. The three column treatments are mutually exclusive; the
progress bar combines with any of them.

| Pill | Where it draws | What it shows |
|---|---|---|
| **Siblings** | inside the current cell's sticky box | that level's siblings — all parts at L1; the sections of the current part at L2, with the previous and next part named faintly above and below. Current = title + gist; adjacent = title; the rest = fainter title; the ones already read fade. Non-current cells draw as today. |
| **Neighbours** | inside the current cell | the previous item's title faintly above the gist, and the next item's title pinned to the *bottom* of the cell with `position: sticky; bottom`. VS Code's sticky scroll, both ways. |
| **Panel** | a fixed panel over the column, top-anchored | the whole level as a list, with part headings between the sections, the current item at the top with its gist, tiers by distance. The cells beneath still draw their borders and tints. |
| **Centred** | the same panel, centre-anchored | Greg's version: the current item held ~40% down the viewport, neighbours above and below in three discrete tiers, the list sliding so the current item stays put. |
| **Progress** | the current cell's box, and the panel's current item | a hairline showing how far through this item you are. |

Why both in-cell *and* hoisted variants: the in-cell ones keep the table's cell boundaries (the
list lives inside the cell it describes, and stops where the next cell starts), but a cell shorter
than its list clips it —
a one-paragraph section cannot hold a list of six siblings. The panel gives up that alignment and
in exchange never clips and can centre. Which trade is right is what the toggles are for.

## What "current" means

The cell at each depth that contains the reading line — the same line `?at=` is measured against
(`stickyOffset() + 1`, see [position.ts](../../src/web/position.ts)). Section granularity is enough:
every gist-column boundary is a section boundary. It is *not* the debounced `?at=` value, because
the sticky handover in the table is instant and the list has to switch with it; a rAF scroll
listener in the table computes it live. Row state changes only at section boundaries; the progress
fraction is written straight to a CSS custom property so a scroll frame never re-renders the table.

## Things that could go wrong, known in advance

- **`overflow: hidden` on a cell would kill sticky** — it makes the cell the scroll container the
  sticky child positions against, so the gist never moves. If clipping is needed, `overflow: clip`
  does not create a scroll container. Verify in the browser, not by reasoning.
- **Sticky range.** A cell shorter than its sticky box has a range of zero and the box scrolls with
  the cell ([css-sticky-containing-block.md](../reusable/css-sticky-containing-block.md)). The
  in-cell modes will do this on short sections; it is the known cost, not a bug to fix.
- **Neighbours doubles up at a handover**: the current cell's "↓ next" line sits directly above the
  next cell's own title for the moment both are on screen. Transient; accepted.
- **The panel and a horizontally scrolled table.** The panel is `position: fixed` at the column's
  measured x; when the table outruns the window and the middle columns scroll sideways, it
  re-measures on scroll, which is one frame late.
- **Arrow keys over the panel.** It carries `data-nav-depth` so ↑/↓ keep stepping at that level.

## Code

- `src/web/context.ts` — pure: which cell is current at each depth, the sibling and level lists,
  the tiers. Tested in `tests/context.test.ts` against `example/`.
- `src/web/ContextControls.tsx` — the pills and their tooltips.
- `src/web/ContextPanel.tsx` — the hoisted panel for Panel and Centred.
- `src/web/TableView.tsx` — the in-cell modes and the live measurement.
- `src/web/params.ts` — `ctxParam`, `progParam`.
- `src/web/styles.css` § column context.
