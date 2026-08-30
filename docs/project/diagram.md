# Diagram mode

The article as a picture, in the middle band — three of them, one toggle, and
the reader's position marked on every one.

- **The geometry** — [`src/web/diagram.ts`](../../src/web/diagram.ts) for the
  shared vocabulary, [`diagram-d3.ts`](../../src/web/diagram-d3.ts) for the
  graph, [`scatter.ts`](../../src/web/scatter.ts) for the two made of
  paragraphs, and [`diagrams.ts`](../../src/web/diagrams.ts) is the router that
  knows about both. Pure functions, no DOM, tested in
  [`tests/diagram.test.ts`](../../tests/diagram.test.ts),
  [`diagram-graph.test.ts`](../../tests/diagram-graph.test.ts) and
  [`scatter.test.ts`](../../tests/scatter.test.ts).
- **The shell, the interaction and the paint** —
  [`src/web/DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx),
  `§ diagram mode` and `§ drift and trail` in
  [`src/web/styles.css`](../../src/web/styles.css).
- **What the server computes for the last two** —
  [`src/projection.ts`](../../src/projection.ts) over
  [`src/article-vectors.ts`](../../src/article-vectors.ts).
- **Why nothing was installed for the hand-rolled outline** —
  [diagram-mode.md](../plans/diagram-mode.md), which has the whole library
  survey and the answers on Mermaid and on generated images. The outline itself
  is gone; the survey is the reasoning behind the one rule none of the survivors
  gave up. What changed when the data got richer is in
  [`diagram-d3.ts`](../../src/web/diagram-d3.ts).

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
          force                    drift / trail
   ┌───────────────┐            ┌───────────────┐
   │    ◯───◯      │            │  ·   ·  ·     │
   │   ╱ ╲ ╱       │            │ ·  ·   ·  ·   │
   │  ◯───◯····◯   │            │   ·  ·        │
   │   ╲   ╲       │            │  ·   ·  ·   · │
   │    ◯───◯      │            │ ·  ·      ·   │
   │               │            │   ·  ·  ·     │
   └───────────────┘            └───────────────┘
```

| | Vertical axis is | Honest about | Not honest about |
|---|---|---|---|
| **Force** (default, `?diagram=force`) | reading order, **pinned** (`fy`) | *what* clusters with what, across **five kinds of relationship** | exact position — it is a physics settlement |
| **Drift** (`?diagram=drift`) | the article, linearly in **rows** | *where* the piece returns to a subject | how far apart two subjects are — the sideways axis is a projection |
| **Trail** (`?diagram=trail`) | **nothing** — it is the second component | whether the piece travels or circles | position, except through the chain and the colour |

**Two of the three keep document order down the page.** That was the one
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

### There were eight, and five are gone

Greg, 2026-08-27:

> Remove Strata, Mindmap, Arc, Cluster.

And Greg, 2026-08-30, on the Tree:

> Remove the "Tree" diagram from Diagram mode — it's not interesting enough to
> keep, and it overlaps too much with Hierarchy and Outline mode etc.

The five that went share one property: **each of them was a second way of
drawing something the reader could already get elsewhere.** Mindmap and Cluster
were both the containment tree with different geometry — which is the comparison
GPT Sol had already called for `tree` on the grounds that it was done and `tree`
had won. Arc drew the vocabulary edges that Force draws, on a line rather than
in a plane. And Tree, which outlasted them by three days, lost the same argument
to two things outside this mode: the outline panel and the gist columns, which
already show the reader the contents page and do it better in a band this
narrow. Eight chips is also more than a 288px band can show without wrapping to
two rows, and a toggle you have to read twice is not a toggle you press.

**Strata is the real loss, and it is worth naming rather than tidying away.** It
was the only picture here that was *to scale*: a band's height was how much of
the article that section is, in words, and it was the only thing in this app
that answered **"how much of the piece is that section?"** The gist columns
cannot — a section holding forty blocks and one holding three are identical L2
cells, which is the complaint
[structure-panel.md](original-version/structure-panel.md) records against the
previous version.

What answers that question now is weaker: the **spine** beside the band, which
is sized from measured pixel heights and is better again at proportion but
carries no names. The Tree's per-row paragraph count used to be the other half
of the answer, and it went with the Tree; the footer card still shows it for
whatever the pointer is on, one section at a time. If the question comes back,
`strata` is in the history of [`diagram.ts`](../../src/web/diagram.ts) and its
arithmetic was tested.

`DiagramOptions.wordsBefore` is still on the options object and still computed,
which is deliberate: nothing reads it today, and it is the one seam that would
let a future picture's vertical axis mean **words** rather than blocks. That
distinction was GPT Sol's finding against the first round of `strata` — eight
long paragraphs and eight one-line list items are the same number of blocks and
very different amounts of article — and it cost a whole round to learn.

**A cut picture's name in a URL opens Force** rather than an error, which is
the same "degrade to something real" rule every parser in
[`params.ts`](../../src/web/params.ts) follows, and the one place here that has
an actual pasted link behind it. `?diagram=tree` is the one to watch: it was the
default for three days, so it is in more bookmarks than the other four together.
Pinned in `tests/url-state.test.ts`.

### Why Force is the default, and what changed

**Nothing here is free any more.** The Tree was, and that was the whole of its
claim on the default slot: stage 4 had already written a gist onto every
internal node and the block ranges gave the sizes, so the band fetched nothing
at all until you pressed something else.

What is left is the next-best version of the same rule. Force **draws
immediately** — four of its five kinds of line are arithmetic over prose the
browser is already holding (see the graph table below), and the model's opinion
only adds the fifth, folded in on a later render. Drift and Trail have *nothing*
without their model call. So the reader who opens the mode still sees a picture
straight away; they just also, now, buy the dotted lines.

That is a real cost the old default did not have, and it is why the hover card
on each chip says where the picture comes from as well as what it shows.

### Waiting, and failing, without borrowing a picture

Greg, 2026-08-30:

> if while loading and/or if there's an error with one of the others (e.g. with
> semantic embeddings), it falls back to Tree — instead, just show a loading
> spinner or error.

Until then, a picture with no data got the Tree. `layoutDiagram` now returns
**null** ([`diagrams.ts`](../../src/web/diagrams.ts)) and the panel puts a
spinner, or the failure's own words, where the picture would be
(`Waiting` in [`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx)).

Two reasons, and the second is the bigger one:

- **A mode that answers a question you did not ask** — under small type
  explaining that this is not the picture you pressed — is a worse failure than
  an honest wait.
- **The fallback was its own class of bug.** It made "which toggle is lit" and
  "which picture is on screen" two different things, so every branch in the
  panel had to remember which one it wanted, and twice it did not. See
  [§ the corpse](#the-fallback-was-a-bug-factory-and-it-is-gone) below.

**And nothing is bought for a picture that cannot be drawn.** Both paid hooks
are gated on `root !== null` as well as on their picture, which became necessary
the moment Force stopped being a picture you had to ask for: an article with an
unusable tree used to open on the free Tree and buy nothing, and with Force as
the default it would have POSTed for embeddings while the band was printing "no
usable tree" underneath. ⟨Sol⟩, 2026-08-30.

**An empty layout is not a wait, and gets its own sentence.** `layoutForce`
draws only `depth > 0`, so an article whose contents page is a single entry lays
out to a real layout holding no nodes — which took the SVG branch and painted a
blank band with a working scrollbar and nothing in it. The Tree drew that root
as a row, so this only became visible when Force became the default. Also
⟨Sol⟩'s, the same day.

The failure text is the **server's own words**, and the reason for that has its
own history: it said "Could not reach the embedding model" for every failure,
including the one that was actually happening in production for the whole of
this feature's life — an account not allowed to use the model, which no amount
of reaching would have fixed. Consequence first, reason after, bracketed code
last, per [copy.md](copy.md).

### Each chip says what it is, and what it costs

Greg, 2026-08-27:

> add tooltips when hovering over each Diagram button to explain how it works

A real hover card ([`Tooltip.tsx`](../../src/web/Tooltip.tsx), Floating UI),
not the `title` attribute the chips had before. Two paragraphs: **what the
picture shows**, then **where it comes from and what it costs**. `TooltipGroup`
makes the neighbours open instantly once one is open, so reading along the row
is one gesture rather than three separate waits — the same shape `Dock.tsx`'s
mode switcher uses.

The `title` attribute was not a smaller version of this. It waits about a
second, cannot be styled, truncates at the OS's own idea of a line, and does not
exist at all on a touch device — for a sentence whose job is to explain what a
picture *is*, that is close to not being there.

**And it needed `keepSide`**, which is a browser finding and not one any test
would have caught. `placement="bottom"` was not what the first version did: the
card is wider than a chip, and Floating UI's `flip` watches *both* axes, so a
card that simply cannot be centred on a chip near the window's left edge counts
as "does not fit" and gets thrown onto the cross axis. The two leftmost chips'
cards came out to the **right**, on top of the two chips beside them — which are
exactly the ones you are reading along towards. The two rightmost chips had room
and behaved, so three quarters of it looked correct. `Tooltip`'s `keepSide` says
*stay on this axis and let `shift` slide you along it*; it is opt-in, because for
a lone trigger in open space the wider search really is better. The dock's mode
switcher never hit this — its cards are narrower than the run of buttons they
sit over.

## The graph Force is drawn from

Force needs more than the tree, and
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

#### Everything that is not the chain got quieter, 2026-08-27

> In Force, make the dotted links a bit fainter, and maybe also the other
> non-sequential links, so it's easier to see.
>
> — Greg, 2026-08-27

Five kinds of line all competing at about the same loudness is a mesh you look
*at* rather than through. The reading-order chain is the one line that is a fact
about the article rather than a claim about it, and it is what the reader is
following — so it keeps its weight and everything else steps back from it:
containment 0.35 → 0.22, vocabulary 0.5 → 0.3, semantic 0.7 → 0.4, anchor 0.9 →
0.72.

**The ladder is unchanged and that is the point.** The order below still holds:
the author's own cross-reference is the brightest of the four quiet ones, the
arithmetic is next, the model's opinion is faintest. What moved is the gap
between the chain and the rest, not the ranking inside the rest — a fainter
dotted line is still dotted, and it is still the only one drawn with a dash.

The **footer card's** left rules did not move with them, deliberately. A line in
the picture is one of hundreds crossing each other and is drawn faint enough to
look through; a rule beside four rows of text is on its own, and at 0.3 on this
ground it is not there at all. Same hue at full saturation in both places — the
alpha is a fact about how crowded the surface is, not about what the line
claims.

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

### What a browser pass reported, and what was actually true

A Sonnet subagent checked the picture in Chrome on 2026-08-27 against a throwaway
preview page. Most of it confirmed the design — the arrowheads are visible and
all point down the page, the vermilion cross-reference reads as the brightest
line despite being the thinnest, the dotted line reads as dotted at 288px, and
nothing overlaps or clips at any of the three widths. Two findings were reported
as bugs and **neither was one**, which is worth recording because both were
reported with more confidence on the fourth telling than on the first.

**"Vocabulary links never render."** True of that page, and a property of the
fixture rather than of the code: `example/` is a 34-block extract with 10 drawn
sections, and it has **zero** vocabulary edges — too little distinct vocabulary
to clear `EDGE_FLOOR`. The real articles have 56, 11, 8 and 3. The agent's first
message hedged this correctly ("worth confirming whether that's just a fixture
gap") and its fourth called it a FAIL.

**"Hovering a bubble does not update the footer card."** It does.
[`tests/diagram-panel-hover.test.tsx`](../../tests/diagram-panel-hover.test.tsx)
mounts the real panel and hovers a real bubble, and the card moves off the
reading position onto the hovered node and shows the author's link text. The
same session reported the whole component crashing and unmounting, HMR refusing
to fast-refresh, and the preview growing toggle buttons mid-run — someone else
was editing the file underneath it, and the preview page was deleted while it
was still open.

The lesson is not that the browser pass was wasted: it produced four real
confirmations that no test could make, about colour and legibility on a
near-black page. It is that **a browser is the wrong instrument for "is this
wired up"**, and the right answer to that question was a mounted component test
that takes 300ms and cannot be wrong about which build it was looking at.

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
  move inside it: ↑ / ↓ step through the drawn order **and take the article with
  them**, Home / End jump to the ends, Enter jumps the article. **←** closes an
  open node and otherwise goes to its parent; **→** opens a closed one and
  otherwise steps into its first child.
  That is the [W3C tree-view pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/),
  and it is written out rather than inherited because SVG has no `ul` and no
  `button` — which is also why each node carries `aria-level`, `aria-setsize` and
  `aria-posinset`: the DOM is flat, so nothing in the markup says that this is
  the second of three sections inside part 2. The kind toggle is a radiogroup
  with the same one-tab-stop-plus-arrows shape, matching `Dock.tsx`.
  (A tab stop per node was the first version. On a forty-section article that is
  forty presses of Tab to get past the panel, and a role describing a widget the
  code had not implemented. GPT Sol's finding, 2026-08-26.)
- **↑ / ↓ as buttons**, under the picture, 44px tall — see
  [§ the step bar](#the-step-bar-and-the-key-that-was-firing-twice) below.
- **Folding a part away is gone**, and saying so is the point of this line. The
  chevron on a Tree row was the only way in that ever worked; ← and → look like
  a second way and are not one, because `layoutForce` gives every bubble
  `hasChildren: false` and both key branches require it. So the collapse set is
  now a constant — `walk`, `buildGraph` and `DiagramOptions` all still honour
  one, and the panel has nothing to drive it with. ⟨Sol⟩ caught the claim that
  ← and → still folded, which was written in the same change that made it false.
- **Where you are** is a ring on the deepest node you are inside, and on Drift
  also a dashed line drawn across at your exact row. The ring is orange rather
  than a fill change, because the fill already means *which part* and a position
  marker must not change colour as you read.

### The step bar, and the key that was firing twice

Greg, 2026-08-27:

> For each Diagram, make sure the up/down buttons work, so that we can use the
> keyboard to move up/down blocks in the text and also follow the progression in
> the diagram. And add big up/down buttons for touch devices (e.g. iPad).

Three things, and the first was a bug.

**↑ and ↓ were firing twice.** The picture's own key handler stepped the roving
tabstop one node; the window-level handler in
[`keynav.ts`](../../src/web/keynav.ts) *also* saw the same press and stepped the
article one section. One key, two distances, neither of them wrong on its own —
and the visible symptom is a picture whose highlight and whose article disagree
about how far you just moved. `keynav` now bails on `e.defaultPrevented`, which
is the general fix: **calling `preventDefault()` is already how a handler says
"this key was mine"**, and a list of elements to exclude is the version that
goes stale the next time some widget grows arrow keys.

**The arrows now follow.** ↑ / ↓ inside the picture move the tabstop *and* jump
the article, which is not what the tree-view pattern says. The pattern's answer
— arrows move focus, Enter activates — is right for a file tree, where
activating opens something you cannot undo. Here activating means *scrolling*,
the cheapest and most reversible thing this app does, so following focus costs
nothing and turns the picture into something you read the article **with**. It
is the documented follow-focus variant, and it is what the gist columns beside
this panel already do. ← and → do not follow on Force, where they walk to the
parent and into the first child: moving around the *structure* is a statement
about the picture, and should not move the reader out of the paragraph they are
in.

**And a pair of real buttons**, because an iPad has no arrow keys and this
panel's own hit targets are a 6px band or a 3px dot. 44px tall — Apple's own
minimum, where WCAG 2.2's Target Size (Minimum) is 24 — because the two sit next
to each other and the cost of missing is going somewhere you did not mean to.
Under the picture rather than over it, for the same reason the whole footer card
is there.

They are **outlines, not filled buttons**, and that is a correction. The first
version gave them `--surface-raised`, which at 160×44 is two mid-grey slabs in a
panel where every other control is a thin border — they read as *disabled* while
live, which is the same mistake
[design-css-overview.md](design-css-overview.md) records against the shelf's
primary button. The fill now arrives on hover, where it means something.

**They step by distinct row, not by node**, and that is the one piece of design
in them. `layout.nodes` is in preorder, so on Force the root, part 1 and
section 1.1 all begin on the same row — stepping by node would press ↓ three
times and move the article nowhere, which reads as a broken button. Rows make
one press always one visible move, and they make the *unit* come out right by
itself: sections on Force, single paragraphs on Drift and Trail, because those
are the rows those pictures draw. The readout between the buttons
(`12 / 47`) is what says which. The step rule itself is `stepTarget` from
`keynav.ts` rather than a second copy, so ↑ here means what ↑ means everywhere:
part-way into an item it goes to the top of the item you are in before it steps
back, which is the track-skip rule from every music player.

**And the row is the row of the block a rung *jumps to*, not the row its range
starts on.** Those are the same number on Force and they are not on a
scatter: a dot's range is stretched to tile the article, so a reader standing
in a paragraph too short to embed still has a dot answering for them, and the
first dot therefore claims row 0 while the block it jumps to may be the third
paragraph. A ladder built from the range put a rung at row 0 whose press landed
at row 2 — so **Previous, from row 1, moved the reader down the page**. GPT Sol
found it in review of the built code; `stepStops` in
[`diagram.ts`](../../src/web/diagram.ts) carries the row and the block together
so the two cannot be looked up separately and disagree.

**The arrows do not step by row**, because a tree widget has to be able to reach
a part and its first section separately even though they start in the same
place. What they do instead is decline to jump when the jump would go nowhere —
`jumpTo` pushes a history entry, so without that guard three presses at the top
of a picture cost three presses of Back and move nothing. Same finding, same
review.

The readout's **unit is read off what is drawn**, not off which toggle is
pressed. An article with no sub-sections, or one whose parts the reader has
folded away, steps by *part* — and a label that is confidently wrong about the
unit is worse than no label, because the number beside it is a count of exactly
that unit.

#### The fallback was a bug factory, and it is gone

Worth keeping, because the bug is what argues for the design. While a picture
with no data was drawn as the Tree, the panel's SVG class and its per-node shape
branch had to come from *what was drawn* rather than from the chip that was lit.
They did not, and the result was Tree geometry wearing Drift's stylesheet: every
row erased by `.diag-drift .diag-box { fill: transparent }`, no dot, no chevron,
and labels at the browser's default size because no `.diag-drift .diag-label`
rule exists. Nothing threw, nothing logged, and the strip above it said the
right thing the whole time. GPT Sol, 2026-08-27 — and it had been live in the
previous round too, with `strata` where `tree` then was.

The fix at the time was a `drawnKind` variable, derived from the same condition
`flat` and `ramp` were already derived from. That worked, and it left the trap
in place: any *new* branch in the panel could reach for `kind` and be wrong
again. `layoutDiagram` returning null removes the second value entirely, so
there is nothing left to disagree with.

**The picture scrolls to keep up.** `.diag-scroll` nudges the marked node into
view when it goes out of it — keyed on the target rather than on scroll events,
so it never has to ask whether a scroll was ours or the reader's, and suppressed
entirely while the pointer is in the picture, because a band you are comparing
against its neighbour must not slide out from under you.

### The footer card, rather than a floating tooltip

The spine solves the same problem with a hover card
([tooltips.md](tooltips.md)); this panel deliberately does not. A hover target
here can be 6px tall, and a floating card over a 6px band covers its neighbours
— which are the thing you are comparing it against, and the entire point of a
picture that is to scale. The spine is 12px wide and has nowhere to put a
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

`drift` and `trail` are the two pictures here that do not draw the article's
**structure** at all. One dot per paragraph, placed by an embedding of what that paragraph says —
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
a fifth of the article looks exactly like a picture of all of it. One
consequence to own rather than hide: **Trail's chain joins consecutive *dots*,
not consecutive paragraphs**, so a segment can silently bridge a run of list
items nobody drew. What *does*
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

What comes back is **how many lanes there are**, which can be fewer than were
asked for: repairing one empty cluster can empty another. A lane nobody is in
would still get a legend chip, drawn beside seven that mean something and naming
nothing — which reads as a bug in the naming rather than as a group that is not
there.

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

#### What a browser actually showed, 2026-08-27

Looked at on `constitution` — 276 dots, 257 segments, 30 arrowheads, in a
271 × 380 box:

**The chain is texture and the colour is the finding.** Sol's plan-stage verdict
was right about the segments: at that density the hairlines are a grey web with
no readable direction, and the arrowheads are too small to pick out. What *does*
work, and works immediately, is `dhue=progress`: the viridis ramp shows the end
of the article clustered hard to one side and the middle spread across the
other, which is exactly the "does it travel or circle?" question Trail exists to
answer — and it answers it without the chain.

So the honest reading is that **Trail's chain has not yet earned its place and
Trail itself has**, which is a different conclusion from either "keep it" or
"cut it", and it is Greg's call which way it goes. The local bright run around
the reader is the half of the chain that is worth keeping either way.

Five more things the pass and two design reviews found, all now changed:

- **The bright run needs `?at=`, and before a reader has scrolled there is
  none.** The browser agent diffed every segment's classes, found only the dim
  steps, and reported the local run as missing; it is there the moment the
  reader's position exists. Worth knowing rather than fixing — a "you are here"
  before the reader is anywhere would be an invention.
- **Arrowheads are gone from the global chain** and drawn on every segment of
  the local run instead. Two design reviews and the browser pass reached that
  independently: *direction along a path you cannot trace is not information*,
  and thirty heads through 263 crossings are clutter.
- **The chain composites additively** (`mix-blend-mode: plus-lighter`), so a
  corridor the article travels repeatedly glows and a single transit stays a
  whisper. It is the one move that turns the crossing count from noise into a
  reading, and it hides nothing to do it. Fable's suggestion, and the best idea
  of the round.
- **Lanes were filling 72% of their own width**, so the gutters closed and a
  histogram of the dots came out smeared across the whole band —
  indistinguishable from `spread`, which is the mode lanes exist to differ from.
  Half now.
- **Two lanes both read "claudes"** on `constitution`. A proper idf is not
  enough when two groups genuinely centre on the article's dominant noun, so a
  later lane now steps down its own list rather than repeating an earlier one's
  headline.

Two more the pass found and fixed. The lane legend was a wrapping row, so with
eight lanes it wrapped after five and chip 6 sat under chip 0 — a legend whose
*order* was the only thing tying a word to a column, which looked perfectly tidy
and required counting. It is a grid of `k` columns now, so chip *i* sits over
lane *i*. And Trail floored its height at 380px in a scroller that came out at
about 350, so a plane you are meant to see whole scrolled by thirty pixels for
nothing.

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

Force is a `role="tree"` of `treeitem`s with levels, sibling counts, and
Left/Right meaning close and open. These two cannot honour that:
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
**$0.0015 and four seconds** on the longest article in the corpus, then cached —
plus a measured **290ms** of principal components and k-means, cached too.

**The vectors are meant to be shared with the Force picture's dotted lines** —
that is what [`src/article-vectors.ts`](../../src/article-vectors.ts) is for —
and today they are not. `similar.ts` still buys its own, because it was being
written by somebody else in this tree on the same afternoon and reaching into a
file mid-flight to save a fifth of a cent is how two people's work gets lost. So
a reader who opens Force and then Drift on a cold article pays twice. Small,
known, and the first thing to fix here; GPT Sol's finding on the built code.

Like Force, this is a fetch a reader can start without pressing anything that
says what it will do, so the gate is narrow: exactly these two pictures, never
the other six.

**In the browser, laying out 276 dots costs 2.7ms** — measured on `constitution`,
2026-08-27, both pictures, averaged over 200 runs. That matters because the
layout memo keys on `atRow`, so it re-runs every time the reader's position
changes: 2.7ms is well inside a frame and the position updates a few times a
second at most. The Force picture's 300-tick simulation in the same memo is the
one worth attacking if this ever becomes a problem, and it is not this feature's
to fix. What is *not* measured here is React re-rendering 276 `<g>` elements on
each of those, which is a browser question rather than an arithmetic one.

## A fifth, being built: Sketch

<a id="sketch"></a>

> I've been disappointed by Diagram mode so far. … Let the agent decide the
> layout completely.
>
> — Greg, 2026-08-30

**Not in the band yet** — the stage, the schema, the painter and the harness
exist and three real articles have been drawn; the artefact, the pipeline step
and the panel have not been wired up. Everything about it, including the review
that found what would have shipped a blank picture as a success, is in
[sketch-diagram.md](../plans/sketch-diagram.md).

The short version, because it bears on the section below. The three pictures
above each answer one question with one algorithm, so every article comes out
the same shape. Sketch has no algorithm: a model reads the piece, decides what
shape the argument is — three supports converging, a ladder, a spine with asides
— and lays it out itself.

**It does not emit SVG**, which is what makes it a different answer from the one
this file rejects below rather than the same one again. The model writes a
*scene* in five primitives with numbers in them
([`src/sketch-scene.ts`](../../src/sketch-scene.ts)), and the numbers are checked
against the article before anything is drawn: every block id has to exist, every
edge has to name a node that is there, and the picture is measured for whether it
still runs down the page. A structure you can check is the whole difference.

## What is deliberately not here

<a id="not-doing"></a>

- **No generated image.** GPT Images 2.0 rendering a Mermaid description was
  considered and rejected: not interactive, a model call per article, and — the
  serious one — an image of a structure cannot be checked against the structure.
  (This is the objection [Sketch](#sketch) had to answer, and it answers it by
  having the model write a *checkable scene* rather than a picture.)
  A picture that puts section 4 inside section 3 is wrong in a way that looks
  exactly like being right ([silent-success.md](../reusable/silent-success.md)).
  There *is* a good use for it, and it is a different feature: a static,
  shareable image of an article's shape — a thumbnail, an OG image.
- **No Mermaid.** Clickable nodes need `securityLevel: 'loose'`, and the node
  labels here are headings from a stranger's web page ([security.md](security.md)).
- **No cross-reference arcs, yet.** The article's own internal links
  ([`internal-links.ts`](../../src/web/internal-links.ts)) would make this a real
  graph rather than a tree. The most interesting thing left, and a second feature.
- **No UMAP, and no t-SNE.** They would separate the clusters far more prettily
  and they were rejected on a *claim* rather than on a cost: their distances do
  not mean anything. The gaps in a UMAP plot are an artefact of its own
  neighbour graph, so a reader asking "are those two paragraphs nearly the same?"
  would be reading a picture that cannot answer. PCA's answer is dull and
  one-directional and the strip says which direction. Also: a dependency, and
  reproducible only with a seeded generator.
- **No cluster-count control**, and no way to ask for a different `k`. It is
  derived and capped, and a slider would be a fourth control in a band that
  already has three.
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
  ([search.md](search.md)); Drift is the one picture left whose vertical axis is
  the article, so it is the one that could. Note the two axes are *not*
  identical — the spine measures rendered pixels and Drift counts rows — so hit
  positions would have to be recomputed rather than copied.
- **A stale projection empties the picture rather than falling back.** The
  fallback is chosen on how many points came back; `scatter.ts` then drops any
  whose block ids the article no longer has. If a re-ingest lands between the
  two, every point is dropped, the picture is an empty listbox and both step
  buttons sit disabled around a dash. Needs a race to reach and has not been
  seen; the fix is to choose the fallback on the points that *survive* the
  join. GPT Sol, 2026-08-27.
- **The containment line in Force is not really visible**, and was not before
  this round either: `--rule` at 0.35 over `--page` measures **1.07:1**, which
  is below where a stroke exists at all. Fixing it means making a line brighter
  in the round that was asked to make lines fainter, so it is written down
  rather than done. The bubbles' own positions carry most of what it says.
- **Nothing here is to scale any more.** See
  [§ There were eight](#there-were-eight-and-five-are-gone). The spine still is.
- **Collapse state is not in the URL.** Everything else about the view is
  ([url-state.md](url-state.md)), and this is the exception: node ids are
  positional and a re-run of `npm run toc` renumbers them
  ([block-ids.md](block-ids.md)), so a pasted link would open the wrong sections
  on an article that had been re-ingested. A link that is quietly wrong is worse
  than a link that carries less.
