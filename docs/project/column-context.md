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

## What a gist column shows now

> Let's make Centred always-on, and get rid of Siblings, Neighbours, and Panel.
>
> — Greg, 2026-08-25, after comparing all four as toggles

In reading mode every gist column — the arc, the parts, the sections — is drawn by a fixed panel
laid over it, listing the **whole level** with the **current item held on the focus line**, 40%
down the window, and the rest as landmarks in fixed tiers above and below. Focus follows the scroll,
never the pointer. The panel is clipped, never scrollable, so the wheel always moves the article.
Hovering any landmark shows its title and gist; the group's open delay is 150ms — enough that
crossing the list fires nothing, short enough not to feel like a wait — and once one is open its
neighbours are instant. In outline mode there is no panel: the table is itself the list.

There is no control. Every toggle this work added has gone: the four modes, and then the progress
hairline — a line under the current item filling as you read through it, which survived the first
cut as the one remaining pill and went the same afternoon:

> please completely remove that new "Progress" pill & machinery - I found it very distracting.
>
> — Greg, 2026-08-25

Worth keeping as a finding rather than a footnote: a thing that moves every scroll frame in the
corner of the eye is a cost even when it is two pixels tall.

Where things live: [`context.ts`](../../src/web/context.ts) decides what the level lists and is
tested in [`tests/context.test.ts`](../../tests/context.test.ts);
[`useColumnContext.ts`](../../src/web/useColumnContext.ts) is the live half — which item is under
the focus line, where the columns are, how far through; [`ContextList.tsx`](../../src/web/ContextList.tsx)
draws the list and the landmarks' tooltips; [`ContextPanel.tsx`](../../src/web/ContextPanel.tsx) is
the panel; the cells under the panel are in [`TableView.tsx`](../../src/web/TableView.tsx); the styles are the
`column context` section of [`styles.css`](../../src/web/styles.css).

### What the panel replaced, and what it cost

> it looks like the new centred-panel view is occluding what used to be there … What have we lost by
> adding this centred-panel? Look for a way to get the best of all worlds.
>
> — Greg, 2026-08-25

The panel covered the column's cells, whose sticky box carried the title, the `§` mark for the
author's own heading, the gist and the block range, and which lit up along the hovered row's ancestor
path. A fade at the panel's top edge let the cell's title show through, which is what Greg saw. Taken
one by one:

- **The content** — title, `§`, gist, range, the arc's step marker — is now drawn by the panel's
  current entry, in the same sizes, and the cell draws none of it. Nothing is shown twice.
- **The hover wash** carries over: entries on the hovered row's ancestor path light up the way the
  cells did, at every level at once.
- **Clicking to jump** works on every entry and on the cells' remaining strip.
- **The boundaries beside the prose** — the one thing a fixed panel genuinely cannot carry, because
  its rows are not the table's rows — are kept by leaving a 10px gutter down the left of the column
  uncovered. The cells underneath still draw their borders, and each gist cell draws a short tick in
  its own tint at its top edge, so the strip reads as a ruler: this is the row where this section
  begins. That is the alignment invariant's remaining visible trace at these levels.
- **The panel is opaque and has no top fade** now, so nothing shows through it.

What is still lost, stated plainly: the current title no longer *starts* on the row its text starts
on. It sits on the focus line instead. That is the trade Centred makes by definition, and Greg chose
it.

### Boundaries in the finer columns

> In the further-right i.e. lower-level columns, can we make it clearer where the higher-level
> boundaries are? I think we're using small-caps right now, but it's not enough.
>
> — Greg, 2026-08-25

Three treatments were built and screenshotted side by side at the top of the article, where the
sections column shows two part boundaries at once:

- **A — rule and bracket.** Small caps in the parent level's tint, a hairline rule above, the run
  of sections bracketed in the same tint down their left edge. Clear as a *divider*, but a section
  still reads as an item that happens to follow a label.
- **B — tinted band.** The heading is a strip in the parent level's tint, and the sections under it
  sit on a faint wash of the same tint. Reads as a *container*: the sections visibly belong to the
  part.
- **C — heavier rule, normal case.** A 2px tint rule, the part's title in normal case with a `§`
  prefix, deeper indentation. The heading reads as one more orange title, and `§` already means
  "the author's own heading" elsewhere on the page, so it cannot be borrowed.

**B is what ships.** The parent's tint is the point in all three: it is the parts column's colour,
not the sections column's, so the eye files the heading with the column to its left. The part you
are in is at full strength; the others recede with their sections. Screenshots are in the session
that made the choice; the CSS comment at `.ctx-group` in
[`styles.css`](../../src/web/styles.css) carries the reasoning.

### The three that went

All four were built as URL-state toggles with tooltips carrying their research, compared, and cut
down to one. Kept here because each taught something:

| Mode | Was | Why it went |
|---|---|---|
| **Siblings** | the level's siblings inside the current cell's sticky box | kept the cell boundary, but a cell shorter than its list clipped it, and the current title sat under its earlier siblings anyway — the alignment it promised was not delivered |
| **Neighbours** | previous title above the gist, next title pinned to the bottom of the viewport with `sticky; bottom` inside an absolute fill | the least information of the four, on the most fragile CSS; GPT had advised cutting it before it was built |
| **Panel** | the same panel, top-anchored, sliding only when the current item left a comfortable band | Centred with less motion, and it lost the one thing Centred is for: the item you are reading held where your eye is |

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
