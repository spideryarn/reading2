# Column context: what a gist column shows around where you are

Four experiments, side by side, in making the coarse columns scannable. Toggled from the
**Context** pills in the controls bar; each pill's tooltip carries the same explanation as this
doc, with the research links. The plan they were built from, and GPT's review of it, is
[docs/plans/column-context.md](../plans/column-context.md).

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

Mid-article the L0 and L1 columns are about 80% blank: the sticky gist sits at the top of a cell
that runs for thousands of pixels, and nothing in the column says what came before or what is
coming. That is a direct consequence of [the tabular view](granularity-zoom.md#the-tabular-view)'s
alignment invariant, and the same limit the spine was built to get round. The spine answers "where
am I in the whole article"; none of the columns answered "what is around me at this level".

> try implementing it multiple ways, with buttons to toggle them on/off so we can play with and
> compare various ideas. For each one, add a rich tooltip to the button explaining the
> working/intent/research.
>
> — Greg, 2026-08-25

## What the research said

Two web searches (Sonnet, 2026-08-25) and a design review by GPT via
[codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md). The findings the design rests on:

- **People don't read a shrunk periphery.** Hornbæk & Hertzum's eye-tracking study of fisheye menus
  ([TOCHI 2007](https://www.kasperhornbaek.dk/papers/TOCHI2007_FisheyeMenus.pdf)) found participants
  barely looked at the compressed region, and for finding a known item plain hierarchical menus were
  much faster than fisheye ones (for browsing, no difference). A shrunk neighbour is a landmark, not
  content.
- **Discrete tiers, never a gradient.** Continuous fisheyes (Bostock's D3 fisheye, the macOS Dock,
  Table Lens) suit icons and numbers, which survive compression; sentences hit a just-legible /
  illegible dead zone. Furnas's own degree-of-interest treatment
  ([1986](https://cspages.ucalgary.ca/~saul/581/exer.eps/4furnas86.pdf)) was omission and
  truncation, not tiny type.
- **Focus follows scroll, never the pointer.** A pointer-driven fisheye reflows under the mouse —
  the feedback loop the [fisheye sketch](granularity-zoom.md#the-other-view-fisheye) already warned
  about. Reading position is stable, and this app already tracks it.
- **"Whole list, current one marked" is what the evidence adds up to.** Wikipedia's
  [sticky-ToC user testing](https://www.mediawiki.org/wiki/Reading/Web/Desktop_Improvements/Repository/Sticky_Header_and_Table_of_Contents_User_Testing)
  (2022–23) found three things separately: the persistent sidebar outline ranked first in every
  group tested, prototypes that showed more of the outline did better, and readers asked for the
  current section to be bolded. Put together that is a full list with a cursor — though the study
  did not test that combination as one thing, a distinction GPT's review insisted on.
- **Cap it.** [VS Code's Sticky Scroll](https://devblogs.microsoft.com/visualstudio/sticky-scroll-stay-in-the-right-context/)
  pins about five lines at most, and users asked to choose whether inner or outer scope wins when
  there is no room for both.
- **Distance in the tree, not in pixels.** Furnas's formula needs an a-priori importance to combine
  with distance, and the outline's levels supply one. Siblings counts distance in the tree — a
  section in another part is beyond the list, however close its row. The panels count distance along
  the list and let the part headings mark the tree's boundaries instead.

## The modes

All URL state — `?ctx=siblings|neighbours|panel|centred` and `?prog=1` — pushing history like
`cols` ([url-state.md](url-state.md#the-parameters)). Off by default, so nothing changes until a pill
is pressed. The three column treatments are mutually exclusive by construction (one parameter); the
hairline combines with any of them. "Current" is always decided by the scroll position, never the
pointer, and every mode leaves the leaves alone: a leaf has no gist, so there is nothing to list,
and the [navLabel contract](granularity-zoom.md#node-shape) is untouched. That includes the
*continuation* cells — a leaf repeated down a deeper column because its branch ended early
([`tree.ts`](../../src/web/tree.ts)) — which are not items at that level and are never listed.

| Pill | Draws where | Shows |
|---|---|---|
| **Siblings** | inside the current cell's sticky box | that level's siblings: every part at L1; the current part's sections at L2, with the previous and next part named faintly at either end. Current = title + gist; adjacent = title; the rest fainter; the ones already read fade. Other cells on screen draw as before. |
| **Neighbours** | inside the current cell | the previous item's title faintly above the gist, and the next item's title pinned to the bottom of the viewport until the cell ends, where it settles. VS Code's sticky scroll, both ways. |
| **Panel** | a fixed panel over the column, top-anchored | the whole level as a list, with the parts as headings between the sections, the current item open. The list stays still and slides only when the current item would leave a comfortable band. |
| **Centred** | the same panel, centre-anchored | Greg's sketch: the current item held on the focus line, 40% down the window, neighbours above and below in fixed tiers. |
| **Progress** | the current item, every level | a hairline filling as you read through the item. |

Where things live: [`context.ts`](../../src/web/context.ts) decides what each mode lists and is
tested in [`tests/context.test.ts`](../../tests/context.test.ts);
[`useColumnContext.ts`](../../src/web/useColumnContext.ts) is the live half — which cell is current,
where the columns are, how far through; [`ContextList.tsx`](../../src/web/ContextList.tsx) draws
the list; [`ContextPanel.tsx`](../../src/web/ContextPanel.tsx) is the hoisted panel;
[`ContextControls.tsx`](../../src/web/ContextControls.tsx) is the pills and their tooltips; the
in-cell modes are in [`TableView.tsx`](../../src/web/TableView.tsx); the styles are the
`column context` section of [`styles.css`](../../src/web/styles.css).

## Decisions worth keeping

- **The in-cell modes keep the cell, not the edge.** Siblings puts the earlier siblings above the
  current title, and Neighbours the previous title, so the current gist no longer starts exactly at
  its cell's top boundary — it starts a few lines down, inside the cell it belongs to. The plan
  overclaimed this and GPT's code review caught it. The cell boundary itself is untouched, which is
  the part the alignment invariant is actually about.
- **Two "current" lines, named separately.** The in-cell modes and the hairline use the *sticky
  line* (`stickyOffset() + 1`) — the same line `?at=` is measured against, so the list changes at
  the exact moment the cell it lives in hands over. The centred panel uses the *focus line*, 40% down
  the viewport, because a panel that centred the item under the header would be describing a section
  the eye had already left. GPT's review caught this: the plan had one "current" doing both jobs.
- **The panel is a bounded window, not a scrollable outline.** A level can hold dozens of sections.
  If the panel scrolled, the wheel would move the panel instead of the article and "focus follows
  scroll" would stop being true. So it clips, with a fade at each end, and the group headings are the
  landmarks for what lies beyond. The spine stays the view of the whole article.
- **Panel and Centred knowingly step outside the alignment invariant.** Their rows are not the
  table's rows, and they are equal-weight lists where the spine is deliberately proportional. That is
  the experiment, stated rather than hidden; the cells underneath keep their borders and tints so the
  two can be compared on one screen.
- **Progress never touches React.** It changes every frame while scrolling, so the sampler writes
  it straight to `--ctx-progress-<depth>` on the root element. Row changes — the only thing that
  re-renders — happen at section boundaries. One sampler, reads before writes, so no frame forces
  layout twice. It measures against whichever line chose the item it sits under: the sticky line,
  or the focus line in Centred mode.
- **Neighbours' bottom pin needs a fill.** A `position: sticky; bottom: 0` element only has range if
  its normal position is at the bottom of its containing block, and a cell's content sits at the
  top. So the cell gets an absolutely positioned fill and the next-title lives at the bottom of that.
  The fill's containing block is made with `position: sticky` and no insets, **not** `relative`:
  the pinned end columns are already sticky with a `left`, and `relative` overrode it and un-pinned
  L0 — found in the browser, exactly as the plan said it would have to be.
- **Kept against advice.** GPT recommended cutting Neighbours as adding little on the weakest CSS
  mechanism. It stayed because the brief was to compare several ways, and it is the cheapest one to
  compare the richer modes against. Its tooltip says so.

## Known costs, stated plainly

- **Siblings clips on a short cell.** A one-paragraph section cannot hold a list of six siblings;
  the sticky box has no range and the list overflows the cell. The Panel modes exist to compare
  against exactly this.
- **Neighbours doubles up at a handover.** For the moment the current cell's end and the next cell's
  start are both on screen, "↓ next" sits directly above the next cell's own title.
- **Centred is half empty at the ends.** At the first and last items, centring leaves the panel
  half blank — and the research is unkind to the premise, since nobody reads the shrunk items.
- **The panel is one frame late when the table scrolls sideways.** It is `position: fixed` at the
  column header's measured x, re-measured on scroll.

## How to decide

GPT's review pointed out that four polished experiments can produce four preferences and no
decision, and asked for a protocol. Three tasks, and what winning looks like:

1. **Resume reading** after a break: open a link mid-article. Which mode tells you fastest what the
   argument had established by here?
2. **What preceded this section?** Without scrolling up, name the previous two sections and the
   part they belong to.
3. **Find a later section** you remember the topic of, and jump to it, in as few glances and clicks
   as possible.

A mode wins if it does all three better than *Off* and does not make the reading column harder to
read. If none does, the answer is the spine's tooltips, which already exist.

## See also

- [granularity-zoom.md](granularity-zoom.md) — the tabular view whose columns these modes annotate,
  the spine, and the fisheye sketch this descends from
- [url-state.md](url-state.md) — `ctx` and `prog`
- [keyboard.md](keyboard.md) — the panels carry `data-nav-depth`, so ↑ / ↓ still step by level over them
- [tooltips.md](tooltips.md) — the pills' tooltips are the spine's, made interactive so the links work
- [browser-testing.md](browser-testing.md) — a hidden tab runs no rAF, so the live half cannot be
  checked there; the sampler was verified by shimming `requestAnimationFrame` and dispatching `scroll`
