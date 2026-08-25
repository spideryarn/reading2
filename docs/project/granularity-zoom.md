# Granularity zoom

The first feature. Read [vision.md](vision.md) first — this is one concrete expression of it.

## Intent

Greg's description (2026-08-24), verbatim, because the wording carries the design:

> The first thing I'd like to try is a kind of — I think of it as a **recursive summarizer**, but
> maybe that's not the right way to think about it, or almost like a **pre-diagram hierarchical view
> of the article**. So, imagine a book: you could think of the book as being divided into chapters,
> which are divided into sections, which are divided into, I don't know, pages or paragraphs, so on.
> And what I'm wondering is if we used an LLM to **summarize multiple levels of granularity**. […]
> As a user, you can sort of go up and down the levels of granularity. And I'm imagining the
> interface, at least the first version, as being the article **up and down**, and then the scales of
> granularity **left and right**. So maybe the furthest right would be the full article, and the
> furthest left would be — and when I say article, I mean text — the furthest left might be one
> sentence per page or per chapter or something. So by **scrolling rightwards, you get more detail.
> By scrolling downwards, you progress through the chronology of the article.**

Two things to hold onto from that. First, "maybe that's not the right way to think about it" — the
recursive-summarizer framing is a starting hypothesis, not settled; the failure modes at the bottom
of this doc are where it would break. Second, "when I say article, I mean text" — nothing here
assumes journalism, or the web, or a particular length.

## The shape

An article rendered at any of several levels of compression, with two axes:

```
                 LEFT  <------------- zoom ------------->  RIGHT
                 coarse                                    verbatim

  ^        L0            L1              L2                 L3
  |    (whole piece)  (chapters)      (sections)        (paragraphs)
  |
  |    "Consciousness   "Why substrate   "The hard problem   Full text of
  d     is not          matters"          returns"           spya-gp3g6s …
  o     substrate-
  w     independent,    "What the         "Predictive
  n     so AI systems    Turing test      processing gives
  |     that talk        can't see"       us"
  |     like minds
  v     need not be     …                 …                  …
        minds."
```

Vertical is position in the article — the same position, at every zoom level. Horizontal is how
much detail you're getting. Scroll right and the text expands under you; scroll left and it
contracts. You do not lose your place doing it — see [Interaction](#interaction), where the anchor
invariant makes that literal.

## The tree

> We give each paragraph a unique ID. We generate a table of contents that's quite deeply nested —
> all the way down to a paragraph level.

That deeply-nested ToC and this tree are **the same structure**, not two — see
[architecture.md § Pipeline](architecture.md#pipeline). The ToC is it rendered as navigation; the
zoom view is it rendered as text.

The article is a flat sequence of blocks with stable ids (`spya-k3m9qt…`) — see
[block-ids.md](block-ids.md) for the format and
[architecture.md § What a block is](architecture.md#what-a-block-is) for what counts as one. Over
that sequence sits a tree in which **every node covers a contiguous range of blocks**, and **a
node's children exactly partition its range** — no gaps, no overlaps, no reordering.

```
  L0  article ......................................... spya-tgnssb … spya-w8z40d
  L1    chapter "Consciousness & Computation" ......... spya-d3g67c … (idx 34–111)
  L2      section "1: Brains Are Not Computers" ....... spya-sk4su6 … (idx 37–62)
  L3        spya-gp3g6s  spya-rg493b  … (leaves, verbatim)
```

That invariant is the whole trick. Because ranges are contiguous and non-overlapping, any level of
the tree read left-to-right is a valid rendering of the article top-to-bottom, and any block id maps
to exactly one node per level. Zooming becomes a lookup, not a re-layout.

**Order comes from the `blocks.json` index, not from the id.** Block ids are random
([and deliberately so](block-ids.md#why-random-and-not-sequential)), so a range `[firstId, lastId]`
is resolved by looking both endpoints up in the block sequence and comparing *those* positions.
Comparing the id strings themselves — `id > start && id < end` — returns a plausible boolean and is
meaningless. The invariant is unchanged and still load-bearing; only the thing that witnesses it
moved from the id to the index.

### Node shape

```ts
type NodeId = string;      // "n0042"
type BlockId = string;     // "spya-k3m9qt"

interface Node {
  id: NodeId;
  depth: number;           // 0 = whole article
  parent: NodeId | null;
  children: NodeId[];      // [] for leaves
  range: [BlockId, BlockId];  // inclusive, contiguous; resolved via the blocks.json index
  title: string;           // 2–6 words, for the ToC and the spine
  gist?: string;           // ONE sentence — what the level above renders. Absent on leaves.
  navLabel?: string;       // leaves only — a ToC row's text. Never rendered in the reading view.
  summary?: string;        // 2–4 sentences, shown on hover/expand, optional
  sourceHeading?: string;  // the author's own heading, if this node came from one
}
```

**Leaves carry no `gist`, but they do carry a `navLabel`.** These are different things, and keeping
them separate is what lets the ToC go "all the way down to a paragraph level" without breaking
[principle 1](vision.md#principles).

- A **gist** is *substitutable prose*. It appears in the reading view **in place of** the text it
  compresses. Leaves never get one, because at the rightmost level the real paragraph is right
  there, and a summary must never be shown where the real sentence could be.
- A **navLabel** is *a pointer to prose*. It appears only in the ToC and the spine — navigation
  chrome, never the reading column. Clicking it takes you to the paragraph; it is never displayed
  instead of the paragraph.

Principle 1 asks that "every generated line should be a door, not a wall". A ToC row is definitively
a door: its whole purpose is to be clicked and left behind. The rule that matters is not "leaves
have no generated text" but **"the reading view never substitutes generated text for prose that
could be shown"** — and that rule is intact.

Two consequences worth stating, because they are easy to get wrong:

- A renderer must never fall back to `navLabel` when `gist` is absent. That fallback silently turns
  navigation chrome into reading content and is exactly the failure principle 1 guards against.
- `navLabel` grows *longer* with depth, where `title` stays short. A chapter has few siblings and
  they are wildly different, so three words distinguish it. A paragraph has twenty siblings all
  about the same subtopic, so three words do not. An entry needs only enough words to tell itself
  apart from its neighbours — and that demand rises as you descend. See
  [table-of-contents.md](table-of-contents.md) for the length rules.

### Where the tree comes from

Most web essays are structurally flat — the Noema test article is ~54 minutes of largely bare
`<p>` with few subheads — so "chapters → sections" usually has to be *proposed*, not read off the
document — and the brief's own "chapters → sections → pages or paragraphs" is a book's structure,
not an essay's. Provisional approach, with the alternatives weighed in
[Q1](open-questions.md#q1):

- Use the author's real headings as hard boundaries where they exist. They are ground truth about
  where the author thought the seams were, and readers recognise them.
- Where a run of blocks is long and unstructured, an LLM proposes boundaries over it by topic shift,
  and titles the resulting nodes.
- Target a roughly even branching factor (~5–9 children per node) so the levels feel like consistent
  strides rather than one level doing all the work.

## Generation

Bottom-up, one pass, precomputed for the whole article and cached.

```
  blocks ──► leaf navLabels ──► section gists ──► chapter gists ──► article gist
             (from block text)  (from children)   (from children)   (from children)
```

(The leftmost step writes leaves' `navLabel`s — the ToC rows for individual paragraphs. Leaves have
no `gist`; the first *gists* appear one level up. See [Node shape](#node-shape).)

Each parent is written from its children's gists and titles, not from the raw text underneath it.
This is what makes the zoom *feel* coherent: level N genuinely is a compression of level N+1, so
scrolling right always elaborates the thing you were just reading, rather than swapping it for a
differently-organised take on the same material. The cost is a telephone-game drift toward the top
of the tree; mitigate by letting each parent also see its range's headings and first/last block, and
by keeping the tree shallow (3–4 levels covers a book-length piece at branching factor 8).

Prompt rules, derived from the [vision](vision.md#principles):

- One sentence for a `gist`, and it must be a *claim or a move*, not a topic label.
  "Seth rejects substrate independence because…" — not "discusses substrate independence".
- Reuse the author's distinctive vocabulary verbatim. Those words are the reader's handholds when
  they descend.
- Never introduce a fact that isn't in the range below.
- No meta-narration ("this section explores…", "the author then turns to…").

Determinism and cost: the whole tree is generated once per article and cached under
`data/<slug>/tree.json` ([storage layout](architecture.md#storage)), keyed on
`hash(extracted blocks) + prompt version + model id`. It is not
lazy — the reader needs the entire leftmost column instantly, since scanning the whole landscape is
the point.

## The tabular view

The first of two planned views, and the one that is built. It is Greg's original framing
(2026-08-24), which he restated after considering the alternative below:

> When I started out, I had this vision basically of a **tabular representation** where up-down is
> chronology in the document and left-right is granularity, with **a column for each level of the
> table of contents**, and that we explicitly create nested table of contents levels just as a normal
> tree hierarchy.

Implemented in [`src/web/TableView.tsx`](../../src/web/TableView.tsx), with the geometry in
[`src/web/tree.ts`](../../src/web/tree.ts).

**It is a literal HTML `<table>`, and that is the point.** One row per block; one column per depth;
an ancestor cell simply spans the rows of its range with `rowSpan`. Because every node covers a
contiguous range and a node's children exactly partition it ([the tree](#the-tree)), that mapping is
exact and needs no layout logic at all — vertical position is *automatically* the same at every level
of granularity, which is the invariant the whole feature rests on. The table isn't a rendering
convenience; it is the tree invariant made visible.

Consequences worth knowing:

- **All levels are on screen at once**, rather than one level at a time. Greg's brief describes
  scrolling left-right *between* granularities; the table shows them side by side instead, so the
  relationship between a gist and the prose under it is visible rather than remembered. The
  granularity buttons in the header toggle columns, which is what "scrolling rightwards" degenerates
  to when every level is already present.
- **Gists stick.** A spanning cell's content is `position: sticky`, so a chapter's gist stays beside
  its text for as long as that text is on screen, then hands over to the next. Without this the
  coarse columns are only readable at the top of each range.
- **Hovering a row lights up its whole ancestor path**, across every column simultaneously — the
  cheapest possible answer to "where am I in the structure".
- **Leaves render `block.html` verbatim**, never a `navLabel`. See the warning in
  [Node shape](#node-shape): falling back to `navLabel` when `gist` is absent would silently turn
  navigation chrome into reading content.

### Two modes: reading and outline

Greg, 2026-08-24:

> There should be one level higher. In other words, I want to be able to easily see the whole table
> of contents.

Those are two different requests and both are satisfied, but not by the same change.

**One level higher** is literal: depth 0 now gets its own column. Without it the coarsest thing on
screen was the parts list, and there was no single place saying what the piece *is*.

**Seeing the whole table of contents** is not about adding a column, and this is the part worth
understanding. In reading mode the ToC rows are all present — but a part's row and the next part's
row are separated by thousands of pixels of prose, so "the outline" is something you scroll through
rather than something you see. Adding L0 does not fix that; nothing in the horizontal axis can.

The fix is in the *vertical* axis, and it was already latent in the table: **hide the text column and
every row collapses to its natural height**, turning the same table into a compact whole-article
outline. Same tree, same rowSpans, same alignment — only the tallest column is gone.

That mode needs one thing reading mode does not: a column for the **leaf `navLabel`s**, which
otherwise have nowhere to render. It appears in outline mode only, and is not user-togglable,
because a navLabel beside the very paragraph it labels is noise, and — per
[Node shape](#node-shape) — must never stand in for prose that could be shown. Hiding the prose
deliberately, to navigate, is the one context where navigation chrome is the point.

`?text=0` opens straight into outline mode, so a whole-article ToC is a shareable link rather than a
button you have to find. `#<blockid>` opens at a paragraph.

### Both at once: the paragraph outline beside the prose

> I really like the Outline 1-sentence-paragraphs. But I also always want to be able to see the full
> text. Can you look for a way to show both the Outline *and* the Full-text-reading at the same time.
>
> — Greg, 2026-08-25

The leaf column — one `navLabel` per paragraph — is no longer confined to outline mode. Turned on
with the **L3** control, it sits between the gists and the prose, so reading mode now contains
everything outline mode had *plus* the article, each label on the same row as the paragraph it
labels. Opt-in, never chosen by auto-fit, because it costs a column's width and most reading doesn't
want it.

**This does not breach the navLabel contract** ([node shape](#node-shape)), and the distinction is
worth being precise about. The rule is that a navLabel must never be shown *instead of* prose that
could be displayed — because a pointer to prose is not a substitute for it. Here the prose is right
beside it. That is annotation, not substitution.

**What it does not solve, stated plainly.** The outline is only compact *because* the text is absent.
Turn the text on and every row grows to prose height, so consecutive labels are separated by
hundreds of pixels: you get the outline *alongside* the text, but you can no longer scan the whole
article's paragraph outline at a glance the way outline mode lets you. Those two things are mutually
exclusive in a single table with shared rows, and no amount of styling changes that — it follows
directly from the invariant that makes the view work at all.

Two ways out, neither built, in rough order of preference:

1. **Elastic rows.** One table still, but rows outside the section you are reading collapse to their
   navLabel while the current section expands to full prose. Keeps the alignment invariant exactly;
   turns the trade from all-or-nothing into a gradient. Closest in spirit to
   [the fisheye sketch](#the-other-view-fisheye), and the two should probably be designed together.
2. **Two synchronised panes**, outline scrolling at its own rate beside the prose. Gives a genuine
   whole-article outline, but abandons shared rows — the one guarantee the tabular view is built on —
   and has to replace it with scroll synchronisation, which is a weaker promise.

### The spine: a bird's-eye rail

> I want the left-hand most column to show a bird's eye view. So perhaps the first and maybe second
> levels of the table of contents in a fairly information dense way. I guess deciding whether it
> should be first or first and second might depend on how many first level there are. Maybe they're
> collapsible, I'm not sure, but I need a way to see where I am in the whole article.
>
> — Greg, 2026-08-25

The last clause is the one that decides the design. **An overview has to be visible all at once**,
and a table column cannot be: consecutive entries are hundreds or thousands of pixels apart, so a
column only ever shows you the entry you are standing in. So the spine is not a column. It is a
separate `position: fixed` rail, the height of the viewport, in
[`src/web/Spine.tsx`](../../src/web/Spine.tsx).

It is **proportional, not a list**. Each L1 gets vertical space in proportion to how much of the
document it actually occupies, so the rail is a squashed picture of the article rather than an index
of it — and the you-are-here band is then a real position indicator rather than a decoration. Greg
chose this over an equal-weight outline knowing the cost, which is that a short part gets a sliver
too thin to hold its own label.

Four decisions worth keeping:

- **Segments are sized from measured pixel heights, not word counts.** In outline mode every row
  collapses to one line, so a 900-word part and a 100-word part become nearly the same height on
  screen; a word-count rail would point confidently at the wrong place. `Spine.tsx` measures the
  real row geometry and re-measures on resize, on mode change, and on `document.fonts.ready`.
  Measuring means the rail is correct in both modes for free.
- **L2 is ticks and hit targets, never labels in the band.** Labels in the band cannot work, and the
  reason is the tree invariant itself: children exactly partition their parent, so the first child's
  label always begins at exactly the same pixel as its parent's, and the two collide. Instead L2
  draws as a hairline (so the article's subdivision stays visible even where there is no room for a
  word of it) with a transparent full-height button over it, because a 1px tick is not something
  anyone can click.
- **The detail the sliver can't hold lives in a hover tooltip.** Every hit target carries one, and it
  is the payoff of the proportional design rather than an apology for it: which part the section
  belongs to, its gist, the sub-sections inside it, its length, and how far into the piece it sits —
  on a band that may be two pixels tall and carry no label at all. The tooltips are *grouped*, so
  once one is open the neighbours open with no second wait and running the pointer down the rail
  reads the article's sections one after another. Built on Floating UI — why that library, and what
  it is doing for us: [tooltips.md](tooltips.md).
- **Where you are is spelled out in a header strip** at the top of the rail, naming the current L1
  and L2. The bands can be one pixel tall; that strip never is. This is what lets the rail stay
  strictly proportional without becoming unreadable.
- **The labels appear only when they are free.** The rail collapses to a tick-only 1.5rem below
  1100px, and *also* at any width where widening it from 1.5rem to 13rem would cost a gist column —
  which for a three-level tree means the labels arrive at about 1280px, not 1100px. A plain width
  threshold made the fit non-monotonic: at 1099px you got three gist columns and at 1100px one, so
  dragging the window *wider* removed two levels of context and handed back a rail nobody had asked
  for. Whatever the right trade between labels and columns is, "wider window, less article" is not
  it. An explicit `cols=` skips the check, since a fixed column count can't be reduced by the rail.
  "Where am I" stays exactly as useful on a small screen; the words are what stops being affordable.
  (Found by `spideryarn2-cd`, 2026-08-25, by sweeping widths — at any single width the old behaviour
  looked like a considered trade. The sweep is now a test: `tests/layout.test.ts` asserts that no
  width ever shows fewer columns than a narrower one.)
- **In outline mode it disappears entirely.** The table there *is* a whole-article overview, so a
  bird's-eye rail beside it would be a second copy of the same thing; the width goes back to the
  columns. Decided in [`layout.ts`](../../src/web/layout.ts) § `fitView`, not in the rail itself, so
  that one function answers every "how wide is anything" question.

Because the spine now carries the coarse levels, the **L0 column is the first thing auto-fit gives
up** on a narrow window (below), and the article-level gist is repeated in the masthead so that
giving it up costs nothing.

### Too many levels: fit the columns, don't just scroll them

> If we had more than two or three levels, I think it will quickly get too narrow if we try and fit
> everything on the screen at once. So maybe we have some minimum width for each column and allow for
> scrolling, and if we do that, perhaps we always keep the leftmost and perhaps the rightmost visible,
> and so the scrolling's just the middle. I don't know, maybe that'd be confusing, but let's try it.
>
> — Greg, 2026-08-24

Built as described, then found wanting and revised. Minimum widths plus horizontal scrolling *works*,
but on any laptop it means a column permanently buried under the pinned prose: three gist columns and
the reading column come to 70rem — 1120px — so a 1000px window is 120px short before you have done
anything. Scrolling to a column you can never see all of is not really an answer.

So the view now **chooses which columns to show, and how wide**, in
[`src/web/App.tsx` § fitting](../../src/web/App.tsx):

- **Shrink first, drop second.** Gist columns squeeze from a comfortable 15rem down to 11rem before a
  level is given up. At 1000px three 15rem columns don't fit but two 11.5rem ones do, and two levels
  of context beat one.
- **Give up the coarse levels first.** They are what the spine is already showing; the finest gist is
  the one that earns its place next to the paragraph it summarises. So L0 goes, then L1.
- **The reading column takes the slack**, so the table fills the window exactly when it can and
  overflows by a known amount when it can't. At 1600px: L0/L1/L2 at 240px and 672px of prose. At
  760px: one gist column and prose, fitting exactly. At 700px it overflows by 44px, and that is the
  first width where it does.
- **Touching a granularity button takes the columns off automatic** and leaves them where you put
  them; an `auto` control puts them back. The window should not quietly overrule a choice you made.

Three things that make this work rather than merely function:

- **The page scrolls horizontally, not an inner container.** Wrapping the table in `overflow-x: auto`
  would force `overflow-y` to `auto` as well, which would silently break every vertical sticky in the
  view — the gists that ride alongside their range, and the two header bars. Instead the document
  itself is wide, the bars are `sticky` on *both* axes, and cell pinning is plain `position: sticky`
  on `<td>`. That in turn requires `border-collapse: separate`, because sticky cells are unreliable
  under `collapse`.
- **Widths are explicit, and the table is `table-layout: fixed`.** This reverses the obvious choice
  and it is worth knowing why. Automatic table layout sizes a column by its content, and the content
  here is prose; combined with the `max-content` wrapper that horizontal sticky scrolling needs, it
  laid every gist out on one unwrapped line and produced a **4231px table inside a 1600px window**.
  Choosing the widths ourselves makes the geometry predictable and makes the fit calculation and the
  rendering agree by construction instead of by two lists of numbers being kept in sync.
- **Only the left end pins, and the asymmetry is the point.** Greg's brief said "always keep the
  leftmost and perhaps the rightmost visible" — and the hedge in *perhaps* turns out to be
  load-bearing. Pinning left is free when you haven't scrolled: the column's static position already
  *is* the left edge, so it sits exactly where it would anyway and only starts covering its
  neighbours once you deliberately scroll away from them. Pinning right is not free. A sticky element
  is painted with **no space reserved for it**, so `right: 0` shifts the last column left by the
  entire horizontal overflow the moment the page loads — covering that many pixels of live content at
  rest, before the reader has touched anything. At 700px with `?cols=0,1,2` that was the whole
  Sections column, 396px of it, hidden under the prose on arrival with nothing to indicate it was
  there. Reserving the space properly means lifting the column out of the table's scroll extent (the
  frozen-pane pattern: two tables kept in sync), which is a large restructure to buy back a behaviour
  that only matters while overflowing — and auto-fit makes overflowing rare. So the prose no longer
  pins; you scroll right to reach it, and the coarse column stays put on the left. (Mechanism
  diagnosed by the `narrow-layout-probe` agent, 2026-08-25.)
- **The left pin sticks at the spine's edge, not at zero.** The rail is `position: fixed`, so it does
  not push the sticky edge along for us; `left: 0` would slide the pinned column underneath it.
- **Overflow has to be discoverable.** macOS hides its scrollbars until you move, so a table that runs
  off the right edge looks identical to one that simply ends there. A fade at the trailing edge says
  "this continues" without claiming a row of chrome, and is drawn only while something is actually out
  there — which the view knows exactly, because it chose the width.

**Below 760px the left column stops pinning horizontally.** The two pinned layers are anchored to opposite
edges, so they overlap once `gist + prose > viewport`; both used to carry the same `z-index`, which
meant the winner was decided by document order rather than by anyone. Now the prose wins explicitly,
and below the collision width the left column simply scrolls with everything else — a gist column you
can scroll away from is better than one permanently underneath the prose. (Threshold identified by
`spideryarn2-c1`, 2026-08-25.)

The way to do that is `left: auto`, **not** `position: static`. Going static also cancels the
element's *vertical* stickiness, and one of the elements involved is a column header — so the first
attempt silently stopped the table head pinning under the controls bar, on exactly the narrow screens
where losing it hurts most. It looked fine in a screenshot at the top of the page and only showed up
in a `getBoundingClientRect()` reading taken 4000px down. A sticky element with `left: auto` has no
horizontal anchor and keeps its `top` one, which is precisely what was wanted.

### Validate the tree, always

The client does not crash on a malformed tree — it silently draws a **wrong article**, because
`rowSpan` arithmetic over bad ranges still produces a plausible-looking table. So the invariants are
checked explicitly by [`src/validate-tree.ts`](../../src/validate-tree.ts):

```
npm run validate-tree -- example
npm run validate-tree -- data/<slug>
```

Anything writing a `tree.json` should run it. It checks contiguity, exact partitioning,
depth/parent agreement, that every block is covered by exactly one leaf, and that leaves carry no
`gist`. It resolves ranges through the `blocks.json` index, never by comparing id strings
([why](block-ids.md#the-cost-we-accepted)).

### The other view: fisheye

Not built. It came out of a conversation on 2026-08-24 about what "efficient but deep" reading
actually needs — the observation being that a single global granularity cannot express the thing
readers most want, which is to be **deep in one place and shallow everywhere else**. Greg:

> You made this suggestion about a fisheye view and I really like the idea of that, but that does
> complicate things and it's a different interface. … So we're going to have a React web server or
> whatever that has two interfaces, two views. One is my tabular version and one is the fisheye
> version. And I'd say do whichever one is simpler first.

The sketch, recorded so it isn't lost:

- A slider sets a **baseline** depth; proximity to the reader's position adds depth on top of it, so
  detail follows attention and the periphery stays compressed with no explicit gesture. This is
  Furnas's degree-of-interest, applied to prose: show content when
  `rank ≤ baseline − distance-from-focus`, where distance is measured in the tree, not in pixels.
- Focus is a **fixed reading line** roughly 40% down the viewport — text flows past a stationary
  line. This is the detail that makes it work: tying focus to the mouse pointer creates a reflow
  feedback loop, where expanding under the pointer displaces the line the pointer was on, which
  expands the next one, and the page churns. Scroll anchors to the focused node's top edge so it
  unfolds *downward* rather than sliding out from under you.
- It wants a per-sentence rank rather than a per-node depth, since granularity varies *within* one
  screen. Whether that rank is derived from tree position (each node promoting its best sentence,
  which guarantees even coverage and gives literally "one sentence per chapter" at the far left) or
  from a global salience score (honest about which passages are dense, but it clumps and leaves whole
  sections blank) is **undecided** — see [Q8](open-questions.md#q8).

Note this view leans toward showing the author's real sentences rather than generated gists, which
is a different bargain from the tabular view's and closer to
[principle 1](vision.md#principles). That tension is worth resolving deliberately rather than by
whichever view gets built second.

## Interaction

**Position is a block id, not a scroll offset.** The client tracks the block id nearest the top of
the viewport (the *anchor*). On a zoom change: find the node at the new depth whose range contains
the anchor, render that level, and scroll so that node sits where the anchor was. The reader's eye
stays put while the text breathes around it.

- ~~**Zoom out (←)** — each visible group of items collapses into its parent's gist.~~
  ~~**Zoom in (→)** — each visible gist is replaced by its children's gists.~~ **Superseded.** That
  was written for a view showing one level at a time; the tabular view shows every level at once, so
  there is no single "current level" for a key to move. Choosing levels is the `L0 / L1 / L2` buttons
  and `?cols=` ([url-state.md](url-state.md#the-parameters)). ← / → were therefore free, and now
  **step through the article one item at a time, at whichever level the pointer is hovering** —
  [keyboard.md](keyboard.md).
- **Discrete levels, animated between.** v1 snaps to integer depths; continuous zoom is a later
  question ([Q4](open-questions.md#q4)).
- **Click a gist to descend into just that node**, leaving the rest of the article coarse. This is
  the focus+context mode and it's likely how the feature is actually used — you scan L1, spot the
  one chapter you care about, and drop into it alone. v1 should support it even if uniform-level
  zoom is the default.
- **Persistent spine.** A thin left rail always shows the L1 titles with the current position
  marked, so the reader never loses the whole-article context regardless of zoom.
- **Reading-progress is preserved across zoom** — blocks the reader has actually passed through at
  the verbatim level are marked, and that marking is visible at coarse levels too (a chapter shows
  as read / part-read / unread). The unit of "read" is the block id, so it survives everything.

## What would make this fail

Worth stating up front, because each is a testable failure mode:

- **The gists are good enough.** If the coarse levels are satisfying to read, we've built exactly
  the thing [vision.md](vision.md) says not to build. Watch for readers who never scroll right.
  Mitigation is in the prompting: gists that assert something specific enough to make you want the
  argument, and that read as pointers rather than as prose.
- **Boundaries feel arbitrary.** LLM-proposed sections that cut mid-argument make the coarse levels
  incoherent and the reader distrusts the whole structure. Test on flat articles specifically.
- **Losing your place.** If zoom transitions jump the reader, the axis metaphor collapses. The
  anchor invariant above is load-bearing; treat a broken anchor as a P0 bug.
- **Uniform-level zoom is the wrong default.** Possible that nobody wants the whole article at L2,
  and everybody wants focus+context. Build both, watch which gets used.
