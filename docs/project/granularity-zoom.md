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
  d     is not          matters"          returns"           p0012 …
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

The article is a flat sequence of blocks with stable ids (`p0001…`) — see
[AGENTS.md § The one contract that matters](../../AGENTS.md#the-one-contract-that-matters), and
[Q3](open-questions.md#q3) for what counts as a block. Over that sequence sits a
tree in which **every node covers a contiguous range of blocks**, and **a node's children exactly
partition its range** — no gaps, no overlaps, no reordering.

```
  L0  article ......................................... p0001–p0412
  L1    chapter "Why substrate matters" ............... p0001–p0088
  L2      section "The hard problem returns" .......... p0012–p0031
  L3        p0012  p0013  p0014 … (leaves, verbatim)
```

That invariant is the whole trick. Because ranges are contiguous and ordered, any level of the
tree read left-to-right is a valid rendering of the article top-to-bottom, and any block id maps
to exactly one node per level. Zooming becomes a lookup, not a re-layout.

### Node shape

```ts
type NodeId = string;      // "n0042"
type BlockId = string;     // "p0012"

interface Node {
  id: NodeId;
  depth: number;           // 0 = whole article
  parent: NodeId | null;
  children: NodeId[];      // [] for leaves
  range: [BlockId, BlockId];  // inclusive, contiguous
  title: string;           // 2–6 words, for the ToC and the spine
  gist: string;            // ONE sentence — this is what the level above renders
  summary?: string;        // 2–4 sentences, shown on hover/expand, optional
  sourceHeading?: string;  // the author's own heading, if this node came from one
}
```

Leaves carry no `gist`: at the rightmost level we render the block's verbatim HTML. A summary is
never shown where the real sentence could be shown instead.

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
  blocks ──► leaf-level gists ──► section gists ──► chapter gists ──► article gist
             (from block text)    (from children)   (from children)   (from children)
```

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
