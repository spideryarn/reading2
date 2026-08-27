# Diagram mode

The article's structure as a picture, in the middle band — three of them, one
toggle, and the reader's position marked on all three.

- **The geometry** — [`src/web/diagram.ts`](../../src/web/diagram.ts). Pure
  functions, no DOM, tested in [`tests/diagram.test.ts`](../../tests/diagram.test.ts).
- **The shell, the interaction and the paint** —
  [`src/web/DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx),
  `§ diagram mode` at the end of [`src/web/styles.css`](../../src/web/styles.css).
- **Why nothing was installed** — [diagram-mode.md](../plans/diagram-mode.md),
  which has the whole library survey and the answers on Mermaid and on generated
  images.

## What it is for

Greg, 2026-08-26:

> Let's try adding a new "Diagram" mode that generates diagrams/maps of the
> structure of the doc. … Perhaps even something graph-based if we can make it
> attractive. … It would be amazing if it was interactive. … think of the
> article's ordering as top to bottom.

It is a **mode**, in the sense [url-state.md](url-state.md) and
[chat-mode.md](../plans/chat-mode.md) use: it takes the band between the spine
and the prose, the article stays exactly where it was, and `?mode=diagram` says
so. The fifth one, and it cost `MODES` one word.

## The three pictures

```
      strata                tree                  mindmap
   ┌──┬───────────┐   ┌───────────────┐    ┌───────────────┐
   │▐ │▌ 1 Waking │   │ ● Being You   │    │      ◉        │
   │▐ │▌   up     │   │ ├─● 1 Waking  │    │   ╭──┴──╮     │
   │▐ ├───────────┤   │ │ └─● 1.1 The │    │ ┌─┴─┐   │     │
   │▐ │▌ 1.1 The  │   │ │    body     │    │ │ 1 │   │     │
   │▐ │▌   body   │   │ ├─● 2 The     │    │ └───┘   │     │
   ├──┼───────────┤   │ │   hard      │    │     ╭───┴──╮  │
   │▐ │▌ 2 The    │   │ └─● 3 Being   │    │     │  2   │  │
   │▐ │▌   hard   │   └───────────────┘    │     ╰──────╯  │
   └──┴───────────┘                        └───────────────┘
```

Eight of them, in three groups. The first three draw the **tree** and are
hand-rolled; the middle three draw a **graph** and are driven by D3; the last
two draw **one dot per paragraph**, placed by an embedding of what that
paragraph is about.

| | Vertical axis is | Honest about | Not honest about |
|---|---|---|---|
| **Strata** (default, `?diagram=strata`) | the article, linearly in **words** | how much of the piece a section *is* | names — a 6px band holds none |
| **Tree** (`?diagram=tree`) | one row per node, sized to its own text | every name, and the nesting | size |
| **Mindmap** (`?diagram=mindmap`) | parts down a centre trunk | shape, at a glance | size, and it stops at two levels |
| **Arc** (`?diagram=arc`) | exact reading order, one row per section | *where* the piece returns to something | size; and it shows relatedness, not argument |
| **Force** (`?diagram=force`) | reading order, **pinned** (`fy`) | *what* clusters with what, and now **five kinds of relationship** | exact position — it is a physics settlement |
| **Cluster** (`?diagram=cluster`) | the dendrogram's even spread | the shape of the nesting | size, and where you are in the article |
| **Drift** (`?diagram=drift`) | the article, linearly in **rows** | *where* the piece returns to a subject | how far apart two subjects are — the sideways axis is a projection |
| **Trail** (`?diagram=trail`) | **nothing** — it is the second component | whether the piece travels or circles | position, except through the chain and the colour |

**Seven of the eight keep document order down the page.** That was the one
property nothing was allowed to give up, and it is what ruled out every mindmap
and graph library in the survey: they spend width to show depth, and in a 288px
band width is the axis we have not got.

**Trail is the exception, and it is a deliberate one.** Both of its axes are
spent on meaning, because the question it answers — *does this piece travel
through its subject or circle back over it?* — is a question about a shape that
cannot be drawn on one axis. What replaces the rule is the chain: reading order
is still in the picture, as a line you can follow rather than as a direction you
can assume. Nothing else here gives the rule up, and nothing should without a
reason of that size.

### Why strata is the default

It is the only thing in this app that answers *"how much of the article is that
section?"* The gist columns cannot — a section holding forty blocks and one
holding three are identical L2 cells, which is the complaint
[structure-panel.md](original-version/structure-panel.md) records against the
previous version. Here one is thirteen times taller, and the whole shape of a
piece — a long setup, three even middle parts, an abrupt end — is one glance.

#### It is to scale in words, since 2026-08-27

It used to count **blocks**, which is a weaker claim than "how much of the
piece" — eight long paragraphs and eight one-line list items came out the same
height, and a thousand-word code block was one row. GPT Sol flagged it in review
and this doc recorded it as the obvious next change; building the graph
(below) made it nearly free, because a `Block` was carrying its own word count
all along.

The axis is now a prefix sum of words (`wordsBefore` in
[`graph.ts`](../../src/web/graph.ts)), passed to `layoutStrata` as an option. It
is still not what the **spine** measures — the spine is sized from rendered pixel
heights, which is better again and costs a layout pass this panel has not got —
so the two rails are close but not identical, and a search hit's position cannot
simply be copied from one to the other.

What is left of the old caveat: a section of nothing but images legitimately has
zero words, where it could never have had zero blocks. `layoutStrata` floors
every extent at 1 so that such a section is a thin band rather than a division by
zero.

#### The old caveat, kept for the record

Worth being exact about, because "to scale" invites the stronger reading. A block
is whatever stage 3 split out ([architecture.md](architecture.md)) — a paragraph,
a heading, a list item, a figure, a code block. So:

- eight long paragraphs and eight one-line list items are the same height;
- a thousand-word code block is one row;
- a section that is mostly headings looks longer than it reads.

It is the same unit the summary panel's `18¶` badge already counts, so the two
agree with each other. It is **not** the unit the spine uses: the spine is sized
from *measured pixel heights* (`Spine.tsx`), which is the better answer and costs
a layout pass this panel has not got. Weighting each block by its text length
would close most of the gap without measuring anything, and is the obvious next
change — noted below rather than done, because it needs a weight per block
threading through [`buildSummaryTree`](../../src/web/tree.ts), which several
other panels share.

Flagged by GPT Sol in review, 2026-08-26; the previous wording here promised
paragraphs and delivered blocks.

It is also the picture that **costs nothing**. Stage 4 already wrote a gist onto
every internal node and the block ranges already give the sizes, so unlike chat,
glossary, search and summary there is no artefact to wait for, no job to run and
no model call to pay for. The band fetches nothing at all. See `DiagramBand` in
[`App.tsx`](../../src/web/App.tsx).

### Why "mindmap" is not really a mindmap

A published mindmap grows sideways from a root. This one is a **herringbone**: a
trunk down the middle, parts alternating left and right in reading order,
sections stacked under their part. It keeps the mindmap's look — a spine, curved
stems, rounded pills — and throws away its axis. Calling it Mindmap in the toggle
is a concession to what a reader will be looking for.

Sides alternate by part index rather than by which side has room, because a
picture that rearranges itself when you close a section is a picture you have to
read again.

## The graph the last three are drawn from

`arc`, `force` and `cluster` need more than the tree, and
[`graph.ts`](../../src/web/graph.ts) builds it. **Five kinds of edge, and they
are not five versions of one claim.** They form a ladder, ordered by how much
each one actually knows — which is why the stylesheet gives each its own weight
and dash rather than three shades of grey:

| edge | where it comes from | costs | what it is |
|---|---|---|---|
| **parent** | the tree | nothing | containment |
| **sequence** | the tree | nothing | reading order |
| **anchor** | the article's own HTML | nothing | **the author linked these two passages** |
| **vocabulary** | tf-idf over the prose | nothing | arithmetic — a hint about shared subject matter |
| **semantic** | an embedding model | **a model call** | an opinion, and the only one that can be wrong invisibly |

The first four are free, instant, and need no fetch, which is what lets these
pictures work on an article nobody has paid for. Only `semantic` is different,
and only `force` asks for it.

### Sequence is a chain now, not a list of siblings

> Add thick links with an arrow on one end to show the sequence, i.e. between
> each consecutive pair.
>
> — Greg, 2026-08-27

Until then a sequence edge meant "next among my **siblings**", so it joined 1.1
to 1.2 and part 1 to part 2 — and never joined 1.4 to 2.1. The article's actual
reading order was the one relation the graph did not have, and it was missing at
every part boundary, which is exactly where a reader cannot work the answer out
for themselves.

It is now **one chain through the deepest drawn nodes**, which is what makes it
survive collapse: a part with drawn children is not in the chain (its children
are, and the chain runs through them), and a part with none — a depth-1 leaf, or
one the reader has closed — is itself a link. Closing a part *shortens* the
chain rather than breaking it.

**So some bubbles have no arrow through them, and that is right.** On the
constitution the picture draws 57 bubbles: 50 sections and 7 parts. The chain is
49 links through the 50 sections, and the 7 part bubbles hang off it by their
containment lines. A part is a *container*, not a step in the reading — an arrow
from part 1 to section 1.1 would be saying "then read 1.1", when 1.1 is part of
what part 1 *is*. That claim already has a line, and it is the faint one.

**The arrow is drawn at the circle's edge, not at its centre**, and that is the
one piece of arithmetic here that fails while looking fine: `marker-end` paints
the head at the path's last point, and a line drawn centre-to-centre ends
*inside* a filled circle where the head is simply not there. Both ends are
therefore trimmed to the circles' edges — and when two bubbles overlap, which
`forceCollide` allows at the density where rows get thin, **no line is drawn at
all**. The naive trim returns one pointing *backwards*: a short arrow aimed up
the article, which is the precise falsehood the arrow was added to prevent.
`arrowPath` in [`diagram-d3.ts`](../../src/web/diagram-d3.ts) is exported so
that case can be tested directly rather than hoped for.

### Anchor — the one edge somebody meant

> Add thin links if there's an anchor link between sections.
>
> — Greg, 2026-08-27

A published page links to itself. Stage 3 has already repointed every such
`href` at *our* block id (`retargetAnchors` in
[`blocks.ts`](../../src/blocks.ts); [`internal-links.ts`](../../src/web/internal-links.ts)
is the click-time other end of it), so finding them is a scan and a lookup — no
model, no network, nothing to be wrong about except the lookup.

**Everything else in this picture is a guess about relatedness. This is a fact
about the document.** It gets its own colour for that reason, and the footer
card quotes the author's own link text, which is better than anything we could
compute.

Measured across the whole corpus, 2026-08-27: **six of seven articles have none
at all**, and that is the correct output rather than a failure — an essay that
does not cross-reference itself has no cross-references to draw. The seventh is
Anthropic's constitution, and all five of its links are long-range:

```
row  12 → row  97   "being broadly ethical"
row  23 → row 273   "how we think about corrigibility"
row  30 → row 244   "principal hierarchy"
row  98 → row 173   "discussed below"
row 179 → row 236   "Being broadly safe"
```

Every one is the author saying *this depends on that*, over a distance no other
line in the picture can span truthfully.

**It is a DOM parse, not a regex, and the argument for the regex was wrong.**
The first version scanned `block.html` with `matchAll`, reasoning that this is
not arbitrary web HTML — it is jsdom's own serialisation, so it is well-formed
and double-quoted. True, and not enough. GPT Sol produced the counterexample:
`<a title="1 > 0" href="#target">` is **valid** serialised HTML, because the
serialiser escapes `&`, `<` and `"` in an attribute value and has no reason to
escape `>`. A `[^>]*` pattern stops at that `>` and finds no link at all. The
same version showed a reader the literal characters `A &amp; B`. Both failures
are silent, and a parser gets both right for free.

One inert `DOMParser` pass for the whole article, wrapped so each element knows
its row. Inert matters: assigning `innerHTML` to a detached element starts
fetching every `<img src>` in the article, and building a diagram must not
download the pictures.

**And the fallback lies convincingly.** Where there is no `DOMParser` — a Node
script, a test in the wrong environment — the anchor edges are silently absent.
Running the graph over the constitution in plain Node right after this rewrite
reported **0 edges where there are 5**, with everything else identical; it read
exactly like the rewrite having broken the feature. Six of seven articles here
legitimately have none, so "none" is the expected answer nearly everywhere,
which is what makes the wrong "none" so hard to see.

Two guards that exist for articles this corpus does not contain. A **degree
cap** stops an endnotes section collecting a line from every prose section —
that star would be perfectly true and would tell a reader nothing they did not
already know about a bibliography. And an unresolvable fragment draws **nothing**:
inventing a destination is worse than the dead link, and reading a missing
lookup as row 0 would draw a confident line to the first section of the article.

### Semantic — what the embedding model thinks, dotted

> when we generate the Force diagram, let's generate an embedding for each
> block, and add dotted links between the most similar handful of blocks, to see
> what that does to the shape of the Force diagram.
>
> — Greg, 2026-08-27

`POST /api/similar/:slug` → [`similar.ts`](../../src/similar.ts) →
[`embeddings.ts`](../../src/embeddings.ts). The model is `voyageai/voyage-4`,
chosen by [the eval](../../evals/results/embedding-retrieval-2026-08-26.md)
rather than by argument, and the reasoning is in
[semantic-search.md](../plans/semantic-search.md).

Four decisions worth knowing:

- **Pairs come back, not vectors.** A 360-block article at 1024 dimensions is
  ~3MB of JSON. The cosine runs on the server and what crosses the wire is a
  ranked pool of block pairs.
- **The pool is global, not per-block.** Per-block top-K *censors*: a pair that
  is genuinely the best in the article can be absent because both of its blocks
  had K stronger neighbours each, and the client cannot recover what it was
  never sent.
- **Reading order is excluded twice**, because once is not enough. The server
  drops immediately-adjacent blocks; the client drops any *node* pair the
  sequence chain already joins. Two paragraphs six rows apart can sit in
  consecutive sections, sail past the block-level guard, and come out as a
  dotted line drawn along the thick arrow that is already there.
- **POST, not GET.** The first call spends money. GET is supposed to be safe, so
  a prefetcher, a proxy retry or a double-tap on Back may repeat one — none of
  them having asked anybody.

**The dotted line is the honest part.** It is the only edge here that costs
money, the only one that can be confidently wrong, and the only one whose
reasoning nobody can read. A dotted line is the drawing convention for
*inferred*, which is exactly what it is.

#### The scale trap, which is invisible on screen

A tf-idf cosine between two sections of one article runs about 0.12–0.5. An
**embedding** cosine between any two passages of the same article runs about
0.6–0.9 — everything is somewhat like everything. So the obvious move, letting
`semantic` share the vocabulary edge's force strength since both are "how alike
are these", gives a 0.85 pair a strength of 0.55: **as strong as containment**.
Ten of those would not add to the picture's shape, they would *become* it — and
the answer to Greg's question would be an artefact of a fallthrough. It has its
own rule, rescaled from the range it actually occupies, and capped at or below
the vocabulary edges it is there to be compared against. GPT Sol caught this in
review, before it ever ran.

#### What is not built

The vectors are **not stored**. They live in the server process's memory, keyed
by slug and by what the blocks say, and a cold process re-embeds one article for
about $0.002 and a second or two — which on Vercel is the normal case rather
than the unlucky one. Persisting them needs pgvector, a migration and a
re-embed-on-change rule, and that is the substance of
[semantic-search.md](../plans/semantic-search.md). A diagram toggle wanting a
cache is not a good enough reason to settle it early.

### Vocabulary

A vocabulary edge is **cosine similarity between two sections' tf-idf vectors**,
and the threshold is swept against four real articles rather than picked (the
table is in the source). Sections need at least six distinctive terms to form an
edge at all, and no section keeps more than four.

**Say what this is: lexical recurrence, not an understanding of the argument.**
Two sections are joined because they use the same distinctive words. That is
often what you want — *Being honest ←→ Honesty in practice*, *Ethics as practical
wisdom ←→ Having broadly good values* a hundred rows apart — and it is sometimes
merely true: an article that talks about its own sections will link the passages
where it does. So the footer card lists **the words that earned each link**, and
the reader can dismiss one in a second. An earlier version computed those words
and never showed them, which made the curves look more authoritative than they
are; GPT Sol's finding, and the most important one of the round.

Why not ask a model which sections relate? Same rule
[glossary.md](glossary.md) gives for finding occurrences ourselves: **a question
with a checkable answer should not be sent to something that can invent one.**
Term overlap is arithmetic. It is also free and instant, which is what lets these
pictures work on an article nobody has paid for.

## Interaction

- **Hover or focus anything** → the footer card below the picture shows its
  number, title, gist and block count. The title wraps to two lines rather than
  being cut, which is the point of the card — everything *in* the picture is
  truncated by `wrapText`, so if the card truncated too there would be nowhere
  the full name existed. The gist is clamped to three lines, and both carry a
  `title` attribute for the rest.
- **Click anything** → the article jumps there, through the same `onJump` a gist
  cell, a spine segment and an arrow key use.
- **Keyboard** → the picture is one tab stop, not one per node, and the arrows
  move inside it: ↑ / ↓ step through the drawn order, Home / End jump to the
  ends, Enter jumps the article. **←** closes an open node and otherwise goes to
  its parent; **→** opens a closed one and otherwise steps into its first child.
  That is the [W3C tree-view pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/),
  and it is written out rather than inherited because SVG has no `ul` and no
  `button` — which is also why each node carries `aria-level`, `aria-setsize` and
  `aria-posinset`: the DOM is flat, so nothing in the markup says that this is
  the second of three sections inside part 2. The kind toggle is a radiogroup
  with the same one-tab-stop-plus-arrows shape, matching `Dock.tsx`.
  (A tab stop per node was the first version. On a forty-section article that is
  forty presses of Tab to get past the panel, and a role describing a widget the
  code had not implemented. GPT Sol's finding, 2026-08-26.)
- **The chevron on a tree row** toggles; the row itself jumps. Two gestures at
  nearly the same pixel, which is why they are two targets — the file-tree
  convention, and it matters more here because the shapes are small.
- **Where you are** is a ring on the deepest node you are inside, and on strata
  also a dashed line drawn across at your exact row. The ring is orange rather
  than a fill change, because the fill already means *which part* and a position
  marker must not change colour as you read.

### The footer card, rather than a floating tooltip

The spine solves the same problem with a hover card
([tooltips.md](tooltips.md)); this panel deliberately does not. A hover target
here can be 6px tall, and a floating card over a 6px band covers its neighbours
— which are the thing you are comparing it against, and the entire point of a
picture that is to scale. The spine is 1.5rem wide and has nowhere to put a
strip; this band has 400px.

The card is **fixed height**. A card that grew with its gist would resize the
picture above it every time the pointer crossed a band.

## Two things that are wrong in a way you cannot see

**SVG does not clip text and does not error on a bad width.** A label drawn over
the article, a band laid out past the right edge, a column that loses one row per
section — all of them render, and all of them look like a design choice. That is
why every number is computed by pure functions in a module of its own with
tests, and why three of those tests exist because they caught live bugs. The list
is in [the plan](../plans/diagram-mode.md#what-the-tests-caught).

**Text is wrapped by counting characters.** SVG will not wrap, and the honest
alternative is render-measure-relayout, which is two passes, a `ResizeObserver`
per node, and untestable arithmetic. So `wrapText` estimates from one character
width (`CHAR_W`, 0.52 of the font size). It is wrong by a few per cent on any
given string, and the failure it produces is a line ending slightly early or
slightly late. **This means the CSS and the TypeScript share a secret**: change a
font size, family or padding in `§ diagram mode` and the wrapping arithmetic is
now wrong, silently. `CHAR_W` is the number to move.

## Colour

Eight positional hues, one per part, reused round the article — the same eight
the saved searches use ([colour-scales.md](colour-scales.md)), through the same
`--cat-rgb` indirection `SearchPanel` uses, so this file never names a colour. A
reader who has learnt that this green is a search colour should not also have to
learn that it is part 3, and the hue here carries no meaning beyond *these bands
belong together* — which is exactly what lets the eye group a column of sections
without reading any of them.

Every fill is a wash and every stroke is the hue. On a near-black ground a
saturated fill at 20px tall is a shout and thirty of them is a mess.

## The two pictures made of paragraphs

`drift` and `trail` are the only pictures here that do not draw the **tree** at
all. One dot per paragraph, placed by an embedding of what that paragraph says —
[`src/projection.ts`](../../src/projection.ts) does the arithmetic on the
server, [`src/web/scatter.ts`](../../src/web/scatter.ts) turns two numbers into
pixels, and [embedding-scatter-diagrams.md](../plans/embedding-scatter-diagrams.md)
is the design and the review it survived.

```
            DRIFT                                    TRAIL
   y = where you are in the piece            x = component 1, y = component 2
   x = what it is talking about              the line is reading order

   ┌────────────────────────────┐            ┌────────────────────────────┐
 s │   ●                        │            │        ●───●               │
 t │  ●                         │            │       ╱     ╲              │
 a │    ●●                      │            │   ●──●       ●             │
 r │       ●                    │            │  ╱            ╲            │
 t │          ●   ●             │            │ ●              ●▸          │
   │             ●●             │            │  ╲            ╱            │
   │                 ●          │            │   ●─────────●              │
 e │      ●                     │            │        ╲                   │
 n │   ●●                       │            │         ●──▸●              │
 d └────────────────────────────┘            └────────────────────────────┘
```

Greg, 2026-08-27:

> Each block is a point, with the y-axis being position in the document … Then
> do a principle components (or some other dimension reduction/clustering) on
> the semantic embeddings … Hopefully this will give us a rough sense of how the
> article progresses, which sections are similar to one another.

### What they can and cannot promise, which is one direction only

**The tempting sentence is false**, and it was in the first draft of this work:
*two dots close together really are close in the model's space.* An orthogonal
projection can only ever **shorten** a distance, so:

- two dots **far apart** really were at least that far apart — sound;
- two dots **close together** may be two passages whose entire difference lay in
  one of the 1,022 directions this threw away.

No percentage rescues the second half: a figure for the whole article says
nothing about any particular pair. So the strip above the picture says it in
words, not only as a number. GPT Sol's finding on the plan, and the most
important one of the round.

Measured on this corpus, 2026-08-27: **the two axes hold about a fifth of the
variation** — 14.6% and 6.4% on `constitution`, 12.3% and 8.2% on the Noema
piece. That is normal for sentence embeddings and it is why the disclosure is
not optional.

The other caveat is the one [the vocabulary edges](#vocabulary) already carry,
and it is worth twice as much here because this one costs money and involves a
model: **these vectors are about subject matter, not argument.** A piece arguing
against something talks about it in the words it would use to argue for it.

### The dots do not tile the article

Only blocks that are prose and at least twelve words get one — the rule in
[`src/article-vectors.ts`](../../src/article-vectors.ts), and the same rule the
Force picture's dotted lines already use, so the two pictures are about the same
set of paragraphs. On `constitution` that is 276 of 360; the other 84 are mostly
headings and one-line list items.

A three-word heading embeds perfectly well and then sits at cosine 0.8 from
every other three-word heading, because what they have in common is being short.

**The strip says how many were left out**, because a picture that quietly drops
a fifth of the article looks exactly like a picture of all of it. What *does*
tile is each dot's row **range**: a dot answers for everything from itself to
just before the next one, so the you-are-here mark never falls in a gap even
though the dots do.

### Sideways on Drift: lanes or spread

Greg asked for both — *"maybe add a toggle so we can choose between dimension
reduction algorithms"* — and they answer different questions.

- **Lanes** (`?dx=lanes`, the default) groups the paragraphs into a handful of
  topics with k-means and gives each topic a column. A subject the article
  returns to is a second stack of dots in the same column, a long way further
  down — which is the thing no other picture in this app can show.
  **Within a lane, sideways means how central to the topic that paragraph is**:
  the core is a tight column down the middle, marginal members lean out, and
  which way they lean is which neighbouring topic they lean towards. That is a
  fact, not jitter — and a reader cannot tell the two apart by looking, which is
  exactly why the pixels are spent on something true.
- **Spread** (`?dx=spread`) puts every paragraph on the first principal
  component. Honest about *degree* where lanes are honest about *grouping*.

`k` is `√(n/4)`, floored at 2 and **capped at 8 — and the cap is a fact about a
300px band rather than about the article.** The usual rule of thumb would say
thirteen topics for a 360-block piece. Said plainly so nobody later reads 8 as a
measurement.

Lanes are ordered left to right by the **median row** of their members, so the
leftmost is what the piece opens with. Median rather than first appearance: one
stray early paragraph should not drag a whole lane to the front.

### Every lane is named, and that is the same rule the vocabulary edges follow

A legend of chips above the picture carries each lane's most distinctive word,
with all three in its hover. tf-idf across the lanes, using the same `terms()`
the vocabulary edges use — one idea in this app of what a distinctive word is.

**A lane a reader cannot name is a lane they have to take on trust**, and "Topic
3" cannot be argued with at all, which makes it look more authoritative than it
is. The first version used `log(1 + k/df)` for the idf, which never reaches
zero — and on `constitution` that left *"claude"* as the top word of four of the
eight lanes, because the article's commonest noun is common in all of them. It
is textbook `log(k/df)` now, so a word in every lane scores zero and drops out.
Found by running it over the corpus rather than by reasoning about it.

### What is different about Trail

It is the risky one, and the review said so before it was built: **276 dots and
263 segments in a 320px box is a ball of wool**, and hairlines and a fade change
its styling rather than its density. Four things, and only the third does real
work:

1. the chain is a hairline, and brightens as the article goes on, so the eye can
   tell which end it started at;
2. an arrowhead every eighth segment, never on one with no room for a head —
   359 heads in this box is a texture, not a direction;
3. **the segments around wherever the reader is standing are drawn bright and
   thick**, and the window shrinks on a short article so the bright run stays a
   landmark rather than becoming most of the picture. This is what makes Trail
   readable *while* scrolling rather than only studiable;
4. **one scale for both axes, letterboxed.** Scaling x and y independently to
   fill the band would draw a 6% component taller than a 15% one, and every
   distance in the picture would be a different lie depending on its direction.
   The empty margin is the picture saying that the second axis is the smaller
   one. GPT Sol's finding.

If it is still unreadable on a real article, the designed escape hatch is to
make Trail's dots **sections** rather than paragraphs — 57 marks instead of 276.
Not built; recorded in the plan, along with Sol's recommendation to cut the
paragraph-level version outright, which was not taken because Greg asked for a
line between each successive pair of block-points and trying includes finding
out.

### The scale is robust, not min-to-max

Measured on `constitution`: component 1 runs −0.649 to 0.331, and its middle
half runs −0.128 to 0.199. Scaling to the extremes would squeeze three quarters
of the article into a third of the band to make room for one outlier. So the
axis is the 2nd to 98th percentile and anything past it is **clamped to the
wall** — a small lie about that dot, and a much smaller one than flattening
every other dot. The same reasoning sizes the dots: the reference is the 90th
percentile of word counts, not the maximum, so one malformed paragraph that
swallowed the article cannot squash everything else to the minimum.

### They are a list, not a tree

The other six pictures are a `role="tree"` of `treeitem`s with levels, sibling
counts, and Left/Right meaning close and open. These two cannot honour that:
276 paragraphs are not a hierarchy and there is nothing to open. So they are a
`listbox` of `option`s, and all four arrow keys step one paragraph. Inheriting
the tree contract would have been a role describing a widget the code does not
implement — the same mistake this panel already made once with one tab stop per
node.

Each dot's `aria-label` carries **its section, its position in the article and
its topic**, because on these two pictures position and colour are the whole
message and [colour-scales.md](colour-scales.md) is emphatic that colour is
never allowed to be the only carrier.

### What it costs

One model call the first time either picture is opened for an article, about
**$0.0015 and four seconds** on the longest article in the corpus, then cached.
The vectors are shared with the Force picture's dotted lines
([`src/article-vectors.ts`](../../src/article-vectors.ts)), so a reader who has
already opened Force pays only for the arithmetic — which is a measured **290ms**
of principal components and k-means, cached too.

Like Force, this is a fetch a reader can start without pressing anything that
says what it will do, so the gate is narrow: exactly these two pictures, never
the other six.

## What is deliberately not here

<a id="not-doing"></a>

- **No generated image.** GPT Images 2.0 rendering a Mermaid description was
  considered and rejected: not interactive, a model call per article, and — the
  serious one — an image of a structure cannot be checked against the structure.
  A picture that puts section 4 inside section 3 is wrong in a way that looks
  exactly like being right ([silent-success.md](../reusable/silent-success.md)).
  There *is* a good use for it, and it is a different feature: a static,
  shareable image of an article's shape — a thumbnail, an OG image.
- **No Mermaid.** Clickable nodes need `securityLevel: 'loose'`, and the node
  labels here are headings from a stranger's web page ([security.md](security.md)).
- **No cross-reference arcs, yet.** The article's own internal links
  ([`internal-links.ts`](../../src/web/internal-links.ts)) would make this a real
  graph rather than a tree. The most interesting thing left, and a second feature.
- **Cluster may not survive either, and `d3-hierarchy` goes with it.** GPT Sol's
  round-two verdict: *"Cut Cluster and d3-hierarchy. It adds no richer
  relationship and is less content-legible than the existing Tree. 'Comparison'
  is not enough reason for a permanent sixth toggle."* That is probably right —
  it draws the containment tree the hand-rolled `tree` already draws, discards
  the vocabulary edges entirely, and needed a 12px label offset to stop
  `cluster()` drawing parents through their own middle child. It is kept for now
  because this round was asked to try several things, and trying includes finding
  out. `d3-shape` goes too if it goes: one cubic connector is not a dependency.
- **Mindmap may not survive.** Two independent reviews — GPT Sol, and a browser
  pass looking at all three side by side — picked it as the weakest and as the
  one to cut if one had to go: legible, but busier than the other two, lopsided
  when an article has few parts, and the first to truncate its labels at 288px.
  It is here because Greg asked for a mindmap by name, and because this is the
  round that finds out which ideas earn their place. The honest replacement for
  the third slot is the arcs below, which would put a real *graph* there rather
  than a third tree.
- **No block weighting.** Strata counts blocks, not words — see above. Giving
  each block a weight would make the picture honest about length rather than
  about count, and is the most valuable small change left here.
- **No UMAP, and no t-SNE.** They would separate the clusters far more prettily
  and they were rejected on a *claim* rather than on a cost: their distances do
  not mean anything. The gaps in a UMAP plot are an artefact of its own
  neighbour graph, so a reader asking "are those two paragraphs nearly the same?"
  would be reading a picture that cannot answer. PCA's answer is dull and
  one-directional and the strip says which direction. Also: a dependency, and
  reproducible only with a seeded generator.
- **No cluster-count control**, and no way to ask for a different `k`. It is
  derived and capped, and a slider would be a fourth control in a band that now
  has three.
- **No lane names inside the picture.** They are in a legend above it and in each
  chip's hover. Three words down a 33px lane would truncate to nothing; rotating
  them costs vertical room the picture is using. Open question for Greg.
- **Trail draws neither the anchor nor the semantic edges** that Force now has.
  The chain is already the densest thing in the band.
- **No persistence of the vectors.** Memory only, keyed by slug, source hash and
  the recipe that made them. When [semantic-search.md](../plans/semantic-search.md)
  lands, [`src/article-vectors.ts`](../../src/article-vectors.ts) is the one file
  that changes.
- **No search hits on the picture.** The spine paints them
  ([search.md](search.md)) and strata is the same kind of rail, so most of that
  work is done. Note the two axes are *not* identical — the spine measures
  rendered pixels and strata counts blocks — so hit positions would have to be
  recomputed rather than copied.
- **Collapse state is not in the URL.** Everything else about the view is
  ([url-state.md](url-state.md)), and this is the exception: node ids are
  positional and a re-run of `npm run toc` renumbers them
  ([block-ids.md](block-ids.md)), so a pasted link would open the wrong sections
  on an article that had been re-ingested. A link that is quietly wrong is worse
  than a link that carries less.
