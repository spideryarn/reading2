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

- **Zoom out (←)** — each visible group of items collapses into its parent's gist.
- **Zoom in (→)** — each visible gist is replaced by its children's gists; at the last step, by the
  actual prose.
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
