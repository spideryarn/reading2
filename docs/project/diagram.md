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

| | Vertical axis is | Honest about | Not honest about |
|---|---|---|---|
| **Strata** (default, `?diagram=strata`) | the article, linearly in blocks | how many blocks of the piece a section *is* | names — a 6px band holds none; and *words*, see below |
| **Tree** (`?diagram=tree`) | one row per node, sized to its own text | every name, and the nesting | size |
| **Mindmap** (`?diagram=mindmap`) | parts down a centre trunk | shape, at a glance | size, and it stops at two levels |

**All three keep document order down the page.** That is the one property that
is not negotiable, and it is what ruled out every mindmap and graph library in
the survey: they spend width to show depth, and in a 288px band width is the
axis we have not got.

### Why strata is the default

It is the only thing in this app that answers *"how much of the article is that
section?"* The gist columns cannot — a section holding forty blocks and one
holding three are identical L2 cells, which is the complaint
[structure-panel.md](original-version/structure-panel.md) records against the
previous version. Here one is thirteen times taller, and the whole shape of a
piece — a long setup, three even middle parts, an abrupt end — is one glance.

#### It is to scale in *blocks*, and that is weaker than it sounds

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
- **No block weighting.** Strata counts blocks, not words — see above. Giving
  each block a weight would make the picture honest about length rather than
  about count, and is the most valuable small change left here.
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
