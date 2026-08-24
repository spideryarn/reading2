# Table of contents

Pipeline stage 4. Builds the nested structure that the ToC sidebar and the
[granularity zoom](granularity-zoom.md) view both render. Read
[architecture.md § Pipeline](architecture.md#pipeline) first — stages 4 and 5 produce
**one** `tree.json`, and it must not become two trees.

Stage 4 builds the *structure* (ranges, hierarchy, titles). Stage 5 fills the
`gist` on each node. This document is about the structure and the titles.

## Intent

Greg's description of what he wanted (2026-08-24), verbatim:

> I guess the way I was imagining it was we'd have the sidecar JSON containing the table of
> contents, and it would say for each table of contents row, it would say something like, okay,
> **this is an H1, and the title is blah, blah, blah, and it should be positioned before Spidey on
> ID XYZ.**

And on how deep a row should go, which turns out to be the load-bearing question:

> **a list of one-word bullets might only need an entry at the list level, but a list of detailed
> discussion-entries might need a ToC for each item**

Earlier, on the shape of the thing:

> We generate a table of contents that's **quite deeply nested — all the way down to a paragraph
> level.**

## We store a tree and derive the flat rows

Greg's row model got the important thing right: **a row is anchored to a block id**, never to a
character offset, a CSS selector, or a scroll position. That is the whole
[provenance principle](vision.md#principles), and everything below keeps it.

Two things it doesn't carry, both of which we need:

**A row has no extent.** "Positioned before `spya-k3m9qt`" says where a section *starts* and
nothing about where it *ends*. Every consumer has to re-infer the end by scanning forward for the
next row of equal-or-shallower depth. That inference is subtly wrong on ragged heading levels — an
`h2` followed by an `h4`, or a level jumping up two steps at once — and it has to be reimplemented
identically in the sidebar, the zoom view, and the summarizer. One of them will get it wrong.

**The zoom view needs real extents.** To render level L2, it must know exactly which blocks each
section owns so it can replace them with one gist. That's a range query, and a start-only row can't
answer it.

So `tree.json` stores `range: [firstBlockId, lastBlockId]` and explicit `children`. Greg's flat row
list is then *derived* — see [`src/toc-flatten.ts`](../../src/toc-flatten.ts). This direction
matters: **flattening a tree into document-order rows is lossless and trivial; reconstructing a tree
from flat rows is neither.** Store the richer thing, render the simpler one.

### `level: "h1"` became `depth` + `sourceHeading`

The row model used one field for two jobs: how deep the row sits, and what HTML tag produced it.
Those come apart immediately, because on a flat essay **most nodes have no tag behind them at all**.
The test article is 8,275 words under 9 headings; every middle level of its tree is proposed by the
model. So:

- `depth` — a number, position in the tree, always present.
- `sourceHeading` — the author's heading text, verbatim, present only when a real heading is behind
  the node.
- `titleSource` — `"heading" | "rewritten" | "proposed"`, so you can always tell whose words a row
  is showing.

## Schema

`data/<slug>/tree.json`:

```ts
interface Tree {
  version: number;
  blocksHash: string;        // ties a tree to the exact blocks.json it was built from
  root: TocNode;
}

interface TocNode {
  id: string;                // "n0042", stable within a tree
  depth: number;             // 0 = whole article
  title: string;             // SHORT at shallow depth, LONGER at leaf depth
  range: [string, string];   // inclusive block-id range; children exactly partition it
  children: TocNode[];       // [] at leaf depth
  block?: string;            // block id, when this node IS a single block
  sourceHeading?: string;    // the author's heading text, verbatim, when one exists
  titleSource: "heading" | "rewritten" | "proposed";
  gist?: string;             // ONE sentence; stage 5 fills this, not stage 4
}
```

The invariant, inherited from [the tree](granularity-zoom.md#the-tree): **every node covers a
contiguous range of blocks, and a node's children exactly partition its range** — no gaps, no
overlaps, no reordering. Contiguity is in `blocks.json` **array order**, not in the id string;
random ids carry no ordering (see [block-ids.md](block-ids.md)). Never write
`if (id > start && id < end)`.

[`src/toc-validate.ts`](../../src/toc-validate.ts) enforces all of it. Run it on every generated
tree — it is what stops a model quietly inventing a block id that doesn't exist.

## Entry length grows with depth <a id="granularity"></a>

The core editorial rule, and the one most likely to be got wrong:

> **A row's only job is to distinguish itself from its siblings.**

At depth 1 a node has perhaps five siblings, all about wildly different things, so three words is
plenty. At leaf depth a node has twenty siblings that are all about the same subtopic, and three
words ("the caching problem") is ambiguous across five of them. Length should track how much
disambiguation the level actually demands.

| Depth | Target | Why |
|---|---|---|
| 0 (article) | 2–8 words | It's the title. |
| 1–2 (chapters, sections) | **2–6 words** | Landmarks. Must be scannable at a glance. |
| leaf (paragraph rows) | **10–15 words** | A paragraph has no name of its own; it needs a claim. |

The cost is real and worth stating. 110-odd leaf rows at ~12 words is about **1,400 words of ToC
against 8,275 words of article — roughly a sixth of the piece**. That is why the sidebar keeps
paragraph rows **collapsed by default**, showing the heading outline until the reader expands a
section. An always-visible flat list of every paragraph is unusable, and it is also the thing
[vision.md](vision.md#anti-goals) warns about: a summary satisfying enough to read *instead of* the
article.

## Not every block earns a row

Every block has an id. That is [the contract](block-ids.md). It does **not** follow that every block
gets a ToC row.

**Never a row of its own:**

- Any block with `gistable: false` in `blocks.json` — images, horizontal rules, and pull-quotes that
  repeat body text verbatim. All 11 pull-quotes in the test article are word-for-word repeats of
  body sentences; giving them rows would print the same claim in the ToC twice.
- **Figure captions.** A `<p>` matching `^(Figure|Fig\.|Table|Image|Photo)\s*\d*\s*[:.]` is a caption
  for the adjacent media block, not prose. The test article has three (`Figure 1: Mother Teresa in a
  cinnamon bun.`, `Figure 3: The Watt Governor.`, `Figure 5: The Müller-Lyer illusion.`) and
  `blocks.ts` currently marks them gistable, because they are text-bearing `<p>` elements sitting
  *beside* the image rather than inside the `<figure>`. Stage 4 must filter them.
- Boilerplate: a block whose entire text matches `^(Credits|Share|Subscribe|Related|Tags)$`.

**Merged into a neighbour rather than dropped:** a gistable block under ~25 words that continues the
block beside it — a transition, a one-line setup, a dangling attribution. In the test article that's
`"Given all this, what should we do?"` (7 words) and `"Let's summarize. Many social and
psychological factors…"` (19 words).

Crucially, **merging is not deletion**. A leaf node may cover a *range* of 1–3 blocks. The block
still exists, still has an id, still gets rendered verbatim in the reading view — it just shares a
ToC row with its neighbour. This keeps the partition invariant intact and machine-checkable: leaf
ranges must still tile the entire article with no gaps. If rows could simply vanish, coverage would
be unverifiable and blocks could go silently missing.

Non-gistable blocks are **absorbed into an adjacent leaf node's range** for the same reason. They may
appear *inside* a range; they may never be a node's `block` anchor.

## Headings: verbatim unless genuinely uninformative

Greg's call: use the author's heading text, rewriting only when it tells the reader nothing. A row
that says one thing and lands on a heading that says another is disorienting, so the bar for
rewriting is high, and the test is **mechanical, not a judgment call**:

> Rewrite a heading only if it (a) shares no content word with its own section body, **or** (b) is a
> stock label — `Introduction`, `Background`, `Overview`, `Conclusion`, `Part Two`, `Chapter 3`.
> Otherwise pass it through untouched.

Set `titleSource: "rewritten"` whenever you do, so drift is auditable with one grep instead of a
diff against the source.

Worked example — the test article's four `h3`s:

| Heading | Verdict |
|---|---|
| `1: Brains Are Not Computers` | **verbatim** — a claim, and its content words recur throughout the section |
| `2: Other Games In Town` | **verbatim** — idiomatic, but "games in town" is Seth's own framing and the reader will recognise it on arrival |
| `3: Life Matters` | **verbatim** — short, but "life" is the section's central term |
| `4: Simulation Is Not Instantiation` | **verbatim** — the sharpest claim in the piece |

All four pass. The numeric prefixes stay: they are the author's own enumeration and dropping them
would break the correspondence with the page. This is the expected outcome — **rewriting should be
rare**, and a run that rewrites more than a heading or two is a bug in the rule, not a bad article.

## Building the tree over a flat article

Authored headings are **hard boundaries** — they are ground truth about where the author thought the
seams were, and readers recognise them. Where a run between headings is long and unstructured, the
model proposes boundaries by topic shift. Target branching factor ~5–9 so each level is an even
stride rather than one level doing all the work.

Worked through for the test article — 139 blocks, 122 gistable, 9 headings:

```
  depth 0  article ......................................... 139 blocks
  depth 1    [proposed] opening ........................... idx   1– 11   (11)
             h2 The Temptations Of Conscious AI ........... idx  12– 33   (22)
             h2 Consciousness & Computation ............... idx  34–111   (78)
             h2 What (Not) To Do? ........................ idx 112–128   (17)
             h2 Soul Machine ............................. idx 129–138   (10)
```

Five children at depth 1 — one proposed, four authored. Note the article *opens* with 11 blocks
before its first heading, so the opening node has no heading to take a title from and must be
proposed.

`Consciousness & Computation` is a container: two blocks of its own preamble, then four `h3`s.

```
  depth 2      [preamble] .............................. idx  35– 36   (2)
               h3 1: Brains Are Not Computers .......... idx  37– 62   (26)
               h3 2: Other Games In Town ............... idx  63– 75   (13)
               h3 3: Life Matters ...................... idx  76– 89   (14)
               h3 4: Simulation Is Not Instantiation ... idx  90–111   (22)
```

Those `h3` runs are still 13–26 blocks each — far above the 5–9 target — so **a proposed level sits
below them**, splitting each into 3–4 topic groups of ~6 blocks. Only then do leaf rows appear.

The shape that falls out is roughly `1 → 5 → 20 → ~110 leaves`: branching factors of 5, 4, and 5.5.
That is the right answer for this piece, and it is only reachable because proposed levels are
allowed to interleave with authored ones. A headings-only tree would give this article **two**
levels and no zoom axis worth having.

## The generation prompt

A ~10k-word article fits comfortably in one pass, so the model sees the whole document and can keep
sibling titles consistent with each other. Longer pieces need section-by-section processing against
a shared style contract — not yet needed, not yet built.

The prompt rules below inherit from
[granularity-zoom.md § Generation](granularity-zoom.md#generation) and
[vision.md § Principles](vision.md#principles).

````text
You are building a nested table of contents for an article. It goes all the way
down to individual paragraphs, and it will be rendered as a navigation sidebar.

You receive the article as a numbered list of blocks. Each block has an id
(e.g. spya-k3m9qt), a tag, and its text.

Produce a tree of nodes. Every node covers a contiguous range of blocks, and a
node's children exactly partition its range — no gaps, no overlaps, no
reordering. The first child starts where its parent starts; the last child ends
where its parent ends.

STRUCTURE

- The article's own headings are HARD boundaries. A node must begin at a
  heading block wherever one exists. Never merge across a heading.
- Where a run between headings is longer than ~9 blocks, propose your own
  boundaries inside it at genuine topic shifts, and give those nodes titles.
- Aim for 5–9 children per node so each level is an even stride.
- Leaf nodes cover 1–3 blocks. Give a block its own leaf node unless it is
  under ~25 words AND directly continues its neighbour (a transition, a
  one-line setup, a dangling attribution) — then merge it into that neighbour.
- Blocks marked NOT-GISTABLE must never be a node's `block` anchor. Absorb them
  into an adjacent leaf node's range.

TITLES

- Length grows with depth, because a title's only job is to tell itself apart
  from its SIBLINGS, and deeper siblings are more numerous and more alike:
    depth 1–2 (chapters, sections) ....  2–6 words
    leaf nodes (paragraphs) .......... 10–15 words
- A title must be a CLAIM or a MOVE, not a topic label.
    good: "Seth rejects substrate independence because feeling is metabolic"
    bad:  "Discusses substrate independence"
- Reuse the author's distinctive vocabulary verbatim. Those words are the
  reader's handholds when they arrive at the passage.
- Where the author gave the section a heading, use that heading's text
  UNCHANGED and set titleSource:"heading". Rewrite it ONLY if it shares no
  content word with its section body, or is a stock label ("Introduction",
  "Background", "Part Two") — then set titleSource:"rewritten". Rewriting
  should be rare. Titles you invent for proposed nodes get titleSource:"proposed".
- Never introduce a fact that is not in the range below the node.
- No meta-narration. Never write "this section explores", "the author then
  turns to", "we are told that".
- No trailing punctuation on a title.

OUTPUT

JSON only, matching this shape:

{"root": {"id": "n0001", "depth": 0, "title": "...", "range": ["<firstBlockId>",
"<lastBlockId>"], "titleSource": "heading", "children": [ ... ]}}

Use only block ids that appear in the input. Do not invent ids. Do not write a
`gist` field — that is a later stage.
````

### Verify, always

The prompt asks a model to emit a partition over 139 ids. It will occasionally emit an id that isn't
in the input, or a range with a one-block gap. Never trust a generated tree:

```
npm run toc:validate -- output/noema-mythology-of-conscious-ai.blocks.json data/noema/tree.json
```

That check is cheap and it is the only thing standing between a plausible-looking sidebar and one
that silently drops a paragraph.

## See also

- [block-ids.md](block-ids.md) — the id contract these ranges are built on
- [granularity-zoom.md](granularity-zoom.md) — the same tree, rendered as text instead of navigation
- [architecture.md](architecture.md) — where stage 4 sits in the pipeline
- [`src/toc-validate.ts`](../../src/toc-validate.ts), [`src/toc-flatten.ts`](../../src/toc-flatten.ts)
