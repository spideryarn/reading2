# Column context: what a gist column shows around where you are

How the coarse columns became scannable. Four treatments were built side by side as pills you could
toggle, compared, and cut down to the one described here — there is no control and no URL state
left, and the pills and their tooltips are gone with them. The plan they were built from, and GPT's
review of it, is [docs/plans/260825b-column-context.md](../plans/260825b-column-context.md).

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
down the window, and the rest as landmarks in fixed tiers above and below. Held there except when
holding it there would cost more than it is worth: at the very top of the article the focus line can
be nearer the panel's top edge than the item is tall, and a long gist in a narrow column can reach
past the panel's foot. In both cases the item is moved off the line rather than cut, because a whole
item matters more than an exact position. Crossing a boundary glides rather than jumps, so for a
moment the list is chasing the line rather than sitting on it. Focus follows the scroll,
never the pointer. The panel is clipped, never scrollable, so the wheel always moves the article.
Hovering any entry that isn't the current one — a landmark or a part heading — shows a card with its
crumb, title and gist; the group's open delay is 150ms, enough that crossing the list fires nothing
and short enough not to feel like a wait, and once one is open its neighbours are instant. In
outline mode there is no panel: the table is itself the list.

### How much a landmark says

> The "Argument" column is great, but it's not using the full vertical height to display as much
> information as it could be. Perhaps it could always show them all, with the current one centred?
> Perhaps also with some kind of fisheye effect?
>
> — Greg, 2026-08-26

It did already show them all, and the current one was already centred — the thing actually missing
was **density**. A landmark got one clamped line of sentence in the arc column and, in the parts and
sections columns, its title and nothing else, however much room the column had. So the arc's five
parts left most of a twelve-hundred-pixel panel blank: the same complaint the panel was built to
answer, one level up.

So a landmark's line budget is worked out from **how many entries the level has and how tall the
panel is** — [`landmarkLines`](../../src/web/context.ts), tested in
[`tests/context.test.ts`](../../tests/context.test.ts). A level of five gets several lines each, so
the arc column reads as five sentences with the one you are in set large and unclamped; forty
sections under six part headings get none and stay the title-only list they already were. In
between it steps down, and where it lands depends on the window as much as the count. A title
column shows its gist under its title; the arc column, which has no titles, keeps at least one line
whatever the budget says, because its sentence is the only content it has and a landmark reading
`3 / 5` and nothing else is a hole in the list.

Three things about that number are deliberate:

- **It is estimated, and that is a trade rather than a free win.** GPT's review made the case for
  measuring properly — the candidates are a ladder of five, so you can render all five off-screen at
  the real column width, measure once and take the largest that fits, with no measure-resize-measure
  loop anywhere. That would be right about wrapped titles, wrapped headings and the open entry's
  real height, which the estimate is only approximately right about. It is not built because it is
  five hidden renders per panel per resize to choose between three lines and four. What *is* built
  so the estimate can be checked rather than eyeballed: the panel carries its chosen budget as
  `data-ctx-lines`.
- **Everything in it leans towards undershooting.** A landmark's title is charged as two lines,
  because in an eleven-rem column most section titles wrap. Blank space is recoverable and visible;
  entries pushed off the foot of a panel that cannot be scrolled are neither.
- **Nothing that moves while the reader scrolls goes into it** — and there are two such things,
  which look like one problem and are not. `window.innerHeight` is the first: on a phone or an iPad
  the browser's own toolbars collapse *as you scroll* and it grows seventy to a hundred pixels while
  they do, enough to cross a line threshold on a six-item level, on the device this app is most for
  ([touch.md](touch.md)). GPT's review found that one. So the budget reads `100svh`, the viewport
  with the chrome showing, which does not move when the chrome does; no JS property reports it, so
  [`useColumnContext.ts`](../../src/web/useColumnContext.ts) reads it off a zero-width probe styled
  `height: 100svh`, and where `svh` is unsupported the declaration is dropped, the probe is 0 tall,
  and the fallback to `innerHeight` is the one branch rather than a plausible wrong number.

  The second is **the panel's own top edge**, and it is the one that actually bit. `ColumnRect.top`
  is the header row's bottom, and that row is sticky under the masthead, so it settles over the
  first hundred and fifty pixels of scroll — as its own doc comment says. The version of this that
  took `stableH - rect.top` fixed the phone and reopened the identical hole on every desktop:
  measured in a browser at four lines and three, two hundred pixels down the article, against two
  and one at the top of it. A reader arriving at an article and scrolling once watched every
  landmark in two columns rewrap. The allowance for the bars is therefore a **constant**, which is
  approximate on purpose: being fifty pixels wrong costs at most a line, and being right only after
  the reader has scrolled costs the rewrap the whole calculation exists to avoid.

  Worth keeping as the shape of the mistake rather than as a footnote: the same error wearing
  different clothes survived the review that found its twin, because fixing one *looked* like fixing
  the class. It was caught by measuring in a browser
  ([browser-testing.md](browser-testing.md)) — the number was there to be read only because the
  panel had been made to carry `data-ctx-lines` in the first place.

**The fisheye stays a matter of size, not of length.** Every landmark on a level gets the same
number of lines; what varies with distance is the type — the four tiers' sizes, now carried into the
gist as well as the title. Giving `near` more lines than `far` would have meant several entries
rewrapping at every section boundary, on top of the font-size step that already reflows there, and
the panel re-places itself with `scroll-behavior: smooth`, so each rewrap would glide the whole
list. Fable's review put it as the hairline mistake at larger scale, and the tiers already carry
distance in size and opacity.

Two things that review caught before they reached a screen. **Opacity does not stack well past one
line**: an already-read entry is at 0.6 and a far one at 0.6 again, so a far, read landmark sits at
0.36 — survivable as a single line, a grey smear as four, over exactly the half of the panel the
reader has been through. The tiers' step down reaches the gist by size and colour and no third
multiplier. And the `§` mark for the author's own heading, which the open entry had and landmarks
silently dropped, is now on both.

**And state the cost, because it is the other half of the same change.** Taller landmarks mean fewer
of them fit between the focus line and the panel's edges. On a short level that costs nothing — four
four-line entries still sit comfortably above the line — but on a level whose budget lands at one or
two lines, the list visible around the reader is shorter than it was. That is the trade: the entries
you can see say more, and there are fewer of them. The tooltip still reads any landmark in full, and
the ends of a long level were already past the fade.

One thing the arithmetic gets deliberately wrong. `-webkit-line-clamp` is not the mechanism the old
single line used: `nowrap` with `text-overflow` ellipsized inline at the box's right edge, while
line-clamp wraps first and ellipsizes the last permitted *line*, so even at one line it can cut at
an earlier word. `text-overflow` no longer applies at all, so `overflow-wrap: anywhere` is there to
stop an unbreakable string — a URL in a gist — being hard-clipped with nothing to say so.

**The part heading sticks.** A heading marks each run of sections, and it pins to the top of its
panel while its own run scrolls under it, so the column always names the part you are in — not only
while you are in that part's first section. That is why the panel *scrolls* its list rather than
sliding it with a transform: `position: sticky` reacts to scrolling and not to transforms, so under
the `translateY` this used to use a sticky heading slid away with everything else. The panel is
`overflow: hidden`, which no wheel or trackpad can move but `scrollTop` can, so "focus follows
scroll" is untouched — the wheel still only ever moves the article.

The entries are clickable `<li>`s, not buttons, and cannot be tabbed to. Making them focusable would
put every item of every level in the tab order — three columns of forty sections is a hundred and
twenty tab stops in front of the prose — and ↑ / ↓ already step the article by level
([keyboard.md](keyboard.md)). It is the same trade the clickable `<td>`s make, and Biome flags both.

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
the focus line and where the columns are; [`ContextList.tsx`](../../src/web/ContextList.tsx)
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
  current entry and the cell draws none of it. Nothing is shown twice. The type is the cell's type,
  and it is set explicitly rather than inherited: the gist is prose and stays in the reading face at
  reading size, the arc's step marker keeps the mono tint that stops it reading as a title, and the
  `§` keeps its highlight. Inheriting the list's UI font instead had left the gist a step *larger*
  than the title above it — GPT's review, 2026-08-25, caught it in the stylesheet before anyone
  noticed it on screen.
- **The hover wash** carries over, and now works in both directions. Pointing at a row lights its
  ancestor path across every level, as the cells did. Pointing at a panel *entry* lights the same
  path — the part a section belongs to, and the arc above that. It had to: the wash follows the
  hovered table row, so moving onto a panel used to end it at exactly the moment you pointed at the
  thing you wanted to place. An entry lights its ancestors and not its children; a part holds many
  sections, and lighting all of them is a different gesture from following one thread up.
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

A panel is `position: fixed` at its column's measured x, which is a lie the moment the page scrolls
sideways: the column slides under the pinned left column, and a fixed panel would keep painting on
top of it — cells go under the pinned column, panels did not. So each panel clips itself to the
right of the pinned column's measured edge, which is a no-op in every unscrolled view.

### Three edges GPT's review found

A cross-family review of the finished thing ([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md),
gpt-5.6-sol, 2026-08-25) turned up three cases the code got wrong quietly, each worth keeping
because none of them announces itself:

- **A part heading only visible for its first section.** The clamp that kept the current item whole
  looked at its previous sibling, which is the part heading only for the first section of a part.
  Fixed by making the headings sticky, which is a better answer than a clamp: the heading is *always*
  there now, not merely often.
- **A level with no current item.** Continuation cells are not items, so a column whose first branch
  bottoms out above it — part 1 has no sections of its own, part 2 does — has nothing to be *in* at
  the top of the article. `currentIndex` used to clamp to zero and the column would say "you are in
  the first section of part 2" while the reader was still in part 1. It now returns -1 and the panel
  shows its list flush at the top, nothing marked — the room kept above the list for centring is
  dropped rather than scrolled past, because a short list has no scroll range to get past it and most
  of the panel would have stayed blank. There is always a section you are in; there is not always a
  subsection.
- **Reflow with no scroll.** The sampler listened for `scroll` and `resize`. A late image or a font
  swap moves the focus line into another section under a page that never moved, and the panels would
  keep naming the old one until the reader happened to scroll. Two `ResizeObserver`s answer it, and
  it takes both: one on the **table**, which changes which item is current, and one on each panel's
  own **list**, because a font swap or a rewrapped gist moves every entry below it without changing
  anything the first observer or any prop reports — the current item would slide off the focus line
  and stay there. What still gets past both: a reflow that redistributes rows inside a table whose
  box is unchanged and leaves the list's height identical. Rare, and stated rather than claimed away.

  **And one measurement that is still unexplained.** In a later browser session the sections panel
  settled 31px off the line, at a `scrollTop` matching neither the centred value nor either clamp —
  the arithmetic says it should have been centred. That session was also a bad witness: the tab
  reported itself hidden throughout, the dev server was reconnecting, and the *page's* own scroll
  position jumped 626px between two read-only measurements with no scroll event fired. The dedicated
  run before it, on a healthy page, was sub-pixel at four positions in both directions. So: probably
  the session, possibly not — worth re-measuring on a page nobody else is hot-reloading before
  anyone concludes the placement is sound. A silently adjusted *page* scroll would leave the sampler
  blind in exactly this way, which is the same family as the gap above.

Two of those fixes needed numbers to agree across files — the room above and below the list that
lets its ends reach the focus line, and the height of the fade at the panel's foot, which the bottom
clamp has to know about. Both are now handed to the stylesheet as custom properties from
[`ContextPanel.tsx`](../../src/web/ContextPanel.tsx). Written out in the CSS as `40vh`, `60vh` and
`2.5rem` they were correct only while the focus line sat at 0.4: move the line and the first item
would quietly stop short of it, with nothing to error and nothing to see.

A fifth was the browser undoing the work. The current item was landing tens of pixels above the
focus line mid-article — 75px in the sections column — while sitting exactly on it at the article's
start and end. Nothing in the code or the stylesheet was wrong. **Scroll anchoring** was: the
browser adjusts a scroll container's position to keep visible content still when content *above* it
changes size, and content above it changes size here at every section boundary, because the outgoing
current entry drops its gist and collapses to a title. The browser was helpfully undoing most of the
centring the layout effect had just done. `overflow-anchor: none` on the panel, and the drift is
gone in both directions at every position measured. Added to
[silent-success.md](../reusable/silent-success.md) as its own row: a scroll position you set and the
browser quietly corrects reads back as a plausible number.

A fourth edge was found by checking the fixes in a browser rather than by reading them: the arc's step
marker had lost its mono face and its tint to a **specificity collision** — `.ctx-title.ctx-step`
land on the same element, and `.ctx-item.tier-cur .ctx-title` at three classes beat
`.ctx-item .ctx-step` at two, while a later rule of equal weight still won the *size*. The marker
came out in the UI font, smaller than the gist underneath it. Nothing about the DOM or the
stylesheet looked wrong; only `getComputedStyle` said so. That is the
[silent-success](../reusable/silent-success.md) pattern again — the natural check agrees with the
bug — and it is why the panels were measured in a real browser
([browser-testing.md](browser-testing.md)) rather than declared done.

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
- [url-state.md](url-state.md) — nothing here is URL state any more; `ctx` and `prog` were removed
  with the pills
- [keyboard.md](keyboard.md) — the panels carry `data-nav-depth`, so ↑ / ↓ still step by level over them
- [tooltips.md](tooltips.md) — the landmark cards are the spine's tooltip, with a shorter delay
- [browser-testing.md](browser-testing.md) — a hidden tab runs no rAF, so the live half cannot be
  checked there; the sampler was verified by shimming `requestAnimationFrame` and dispatching `scroll`
- [summaries.md § Following the reader](summaries.md#scrolling-without-taking-the-scroll-off-the-reader)
  — the same problem in a panel the reader *can* scroll, which is why that one nudges rather than
  centres, and why it needs no scroll listener to tell its own scrolling from theirs
