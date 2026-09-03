# Diagram mode

The article as a picture, in the middle band — four of them, one toggle, and the
reader's position marked on every one. Three are geometry over the article's own
tree; the fourth is [a model's drawing](#sketch), and it is the only one that is
not the same shape for every article.

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
  [260826ah-diagram-mode.md](../plans/260826ah-diagram-mode.md), which has the whole library
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
[260826a-chat-mode.md](../plans/260826a-chat-mode.md) use: it takes the band between the spine
and the prose, the article stays exactly where it was, and `?mode=diagram` says
so. The fifth one, and it cost `MODES` one word.

## The three computed pictures

The three below are one family: each answers one question with one algorithm over
the article's tree, so each draws the same shape whatever the article is.
[Sketch](#sketch) is the fourth and is not one of them.

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

Two states were still text-only, and Greg came back to them the same day:

> Make sure the diagrams in Diagram mode show loading spinners if they're
> generating. And/or a button to trigger generation if needed.
>
> — Greg, 2026-08-30

- **Force's strip spins too.** Nothing is drawn *over* that picture — it is four
  fifths there while the call is in flight, and a spinner across it would say
  the wrong thing about what is missing. But the strip beside it only changed
  its *words* when the answer landed, and a line of 10.5px grey that does that
  reads as a caption rather than as work in progress. The spinner is in the
  strip, at size 11 so it sits on the strip's own line.
- **A failure now comes with a verb.** Both fetches run once from an effect, so
  a reader whose request failed had the server's reason on screen and nothing to
  do about it: the way back was to leave the mode and come in again, which
  nothing said. `retry` on [`useSimilar`](../../src/web/useSimilar.ts) and
  [`useProjection`](../../src/web/useProjection.ts) is a **counter in the
  dependency list that the effect body never reads** — a token whose only job is
  to be different — and `TryAgain` in the panel is the button. The counter is
  the one thing here a linter objects to, and removing it as offered would leave
  a button that sets state and fetches nothing; the ignore comment says so.
  The accessible name carries *which* picture, because both failures can be on
  screen at once and two buttons called "Try again" that do different things is
  what a screen reader would otherwise hear.

Pinned in
[`tests/diagram-panel-hover.test.tsx`](../../tests/diagram-panel-hover.test.tsx)
§ *saying it is working, and offering a second try*, which drives the retry
through the real route and counts the requests rather than trusting the button.

#### Two things the review found underneath, and they are opposite mistakes

**A failed repeat used to blank a picture that was already good.** Both hooks
re-fetch when their picture comes back on screen, and the guard beside them has
always promised that toggling away and back "must not throw away an answer
already paid for". Only half was true: the *spinner* was suppressed while an
answer was held, and the `catch` then replaced the answer itself. One flaky
repeat emptied a complete picture and reported a failure about a picture the
reader already had. It is the rule [`useSketch`](../../src/web/useSketch.ts) and
`useIdeas` already write down, applied to the two hooks that had not got it.

**And the repeat should not have happened at all.** The re-fetch was excused by
"the server caches" — it does, *in process*, and `similar.ts` records that a
cold process is the normal case on Vercel and re-embeds the article for about
$0.002. So a reader stepping between the chips was paying to be told what the
panel was already holding, and nothing about a chip press says the article
changed. `bought` makes it **one request per attempt per article**, recorded
when the request settles rather than when it succeeds — so a picture that failed
does not re-buy itself on every toggle either. `retry` is what buys another,
which is what `attempt` being a counter is for.

The two together mean the blanking path is now reachable only through `retry`,
so it is tested against the hooks rather than the panel —
[`tests/diagram-answer-survives.test.tsx`](../../tests/diagram-answer-survives.test.tsx),
and the panel tests that used to cover it began failing on their own "the second
visit did not re-ask, so this proves nothing" line, which is that assertion
doing its job. Both ⟨Sol⟩, 2026-08-30, the second finding in review of the fix
to the first.

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

#### The Sketch chip also says what was actually drawn, 2026-09-03

Greg:

> The "Down the page is time…" tooltip for Diagram/Sketch mode is annoying — it
> shows whenever the mouse is hovering over the Sketch diagram. Perhaps append
> that text instead to the tooltip when I hover over the Sketch button.

It was an SVG `<title>` inside the drawn picture, which is a native tooltip over
every pixel of it — [tooltips.md](tooltips.md) has why that is the worst case of
the paragraph above. So the picture's own caption moved to the one card where a
reader is choosing between pictures: a third paragraph on the Sketch chip's
hover card, between what the picture is and what it costs, and the only line in
any of these cards that is not the same words for every article.

It costs one free GET per Diagram open —
[`useSketchCaption`](../../src/web/useSketch.ts), deliberately not `useSketch`,
because a second `useSketch` on the page is a second `useAutoRun` and a hover
card must not be able to start a $0.20 draw.

**And deliberately not gated on the picture**, which is the one thing the review
changed. Gating it on `kind !== "sketch"` saves a duplicate free GET while
`SketchView` is reading the same artefact, and costs two real faults: the same
chip gives a card one paragraph shorter once you have pressed it, and the reset
that comes with the gate blanks the caption on the way back, so a card opened in
that window grows a paragraph while you are reading it. ⟨Fable, code review⟩,
2026-09-03.

The same review took the `title` attribute off the single-scene picture's name
in the bar ([`SketchView.tsx`](../../src/web/SketchView.tsx)) and gave it the
card the multi-scene row already had — with the SVG `<title>` gone, that
attribute was the only copy of the caption left in the panel on a touch device,
which is the one place a `title` shows nothing at all.

### And then everything under the chips, 2026-08-30

> add detailed tooltips to the various diagram-buttons etc to explain how things
> work
>
> — Greg, 2026-08-30

The chip row got its cards in August and **every control under it then grew a
`title` attribute instead** — the axis and colour chips, the lane legend, the
step bar's readout. So the band had two registers of explanation, and the
weaker one was on the controls that need it more: *Lanes* and *Spread* are two
arrangements of the same dots, and pressing one and looking cannot tell you
which question it answers.

They are all `ControlTip` now — the same head / what / how card, moved into
[`Tooltip.tsx`](../../src/web/Tooltip.tsx) because `SketchView` wants it too and
`DiagramPanel` renders `SketchView`, so the panel could not be the one to export
it. Sketch's own Back, scene row and Enlarge have them as well. The second
paragraph is always the thing a press cannot teach: where the answer comes from,
what it costs, or what the control does *not* promise.

**Two of them could not be opened at all**, and both are the same bug in
different clothes:

- **The step bar's readout is a `<span>`**, so nothing could focus it and a
  keyboard reader could not open the one card that says what a press moves *by*.
  It has a tab stop now that it does not need for its own sake.
- **The step buttons were `disabled`.** A disabled button cannot be focused and
  fires no mouse events, so at the ends of the article — the exact moment a
  reader wants to know why the button is dead — the sentence saying so was
  unreachable by any route. `aria-disabled` now, which keeps the grey and the
  announcement and loses nothing: `stepTo` already returned early on the same
  condition `canStep` reports, so the press was never doing anything anyway.
  **Those two cards have since gone** — Greg asked for them out on 2026-08-31
  (§ the step bar below) — so what keeps the buttons `aria-disabled` is now the
  weaker half of the argument: focus should not vanish from under a keyboard
  reader who has stepped to the last paragraph.
- **And the lane legend's chips are `<li>`s**, which cannot take focus either —
  so the two words a chip is too narrow to show were reachable by pointer only,
  which is the failure the `title` attribute already had there. ⟨Sol⟩ found this
  one and the scene row below in review, 2026-08-30.

**Three of the cards said things the code contradicts**, and that is the risk a
detailed card carries that a one-line `title` did not:

- *Lanes* said sideways inside a lane is how central a paragraph is to its
  topic. It is the paragraph's own first component, on the same scale Spread
  uses — and `laneX` in [`scatter.ts`](../../src/web/scatter.ts) was **rewritten
  in August to stop the centrality version being true**, after ⟨Sol⟩ caught it
  the first time. Writing it back into a card is the same claim returning by a
  different door, and the geometry looks identical either way, which is exactly
  why a card has to be checked against the code rather than against the picture.
- The legend said a word common to every column drops out. It does — *unless
  every word in a column does*, when `laneTerms` falls back to raw frequency
  rather than showing an empty chip, so the commonest word really can appear.
- *Sketch* promised that down the page is reading order and that clicking a box
  jumps there. The picture is **checked** for both, but the bar is `MIN_FLOW`
  0.3 and `MIN_LINKED_SHARE` 0.5 ([`sketch-scene.ts`](../../src/sketch-scene.ts))
  — so both sentences were describing the good case as the guarantee.

**Sketch's scene row was a radiogroup with no arrow keys**, and its comment said
"one tab stop and arrows, like every other switcher here". The roving `tabIndex`
was there from the start and the handler was never written, so a keyboard reader
could reach the scene they were on and none of the others — a picture with more
parts and no way to get to them. It reads as deliberate *because* the roving
tabstop is there, which is the same mistake this panel made once with its tree
role.

Pinned in
[`tests/diagram-panel-hover.test.tsx`](../../tests/diagram-panel-hover.test.tsx)
§ *the controls explain themselves*, which **opens each card and reads it**
rather than looking for a mark on the trigger — Floating UI leaves nothing
durable on a trigger, so an attribute check would pass on a control with no card
at all. Focus is the opener that works in jsdom, measured rather than assumed.
The copy is not asserted; that a control has a card is.

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

### The chain fades outward from the reader, 2026-08-30

> For the diagrams in Diagram mode, we're showing the sequence-arrow
> connections. That's great. Let's improve things by making the connections
> directly either side of the current node most prominent. Then a bit fainter
> for the ones at one remove, then a bit fainter for the ones at two removes,
> etc etc.
>
> — Greg, 2026-08-30

The two lines touching the section the reader is standing in are drawn at full
strength, and each hop further along the chain is a step quieter, until after
half a dozen steps the ramp has landed on the weight the chain has anyway. Both
pictures that draw a chain do it, from one function —
[`chainNearness`](../../src/web/diagram.ts).

Three decisions in it are worth knowing, because each has an obvious alternative
that looks the same and is not:

- **The ramp is spent as `opacity`, not as `stroke`, and that is about the
  arrowheads.** Every chain path shares one `#diag-arrow` marker def, and
  `opacity` on a path paints through to its `marker-end` while `stroke` does
  not — so grading with colour would fade the line and leave a full-strength
  head on it at the far end of every article. Measured rather than reasoned
  about, 2026-08-30, because that failure is silent: two identical paths at
  opacity 1 and 0.3 sharing one marker, rasterised to a canvas over an opaque
  ground and sampled five pixels clear of the stroke. Line 77/255 = 0.302,
  arrowhead 77/255 = 0.302. The head fades at exactly the rate its line does.
- **It brightens toward the reader; it does not dim away from them.** Fading the
  distant chain is the same picture for the first six steps and then puts a
  visible edge exactly where the ramp stops — which reads as a boundary in the
  *article*, not as the end of a highlight — and takes the far half of the piece
  down with it. The ramp's last step is written to equal the unclassed rule, and
  `tests/diagram-css.test.ts` holds the two together.
- **It is computed in the panel, not in either layout.** Force's layout is a d3
  simulation of several hundred ticks; handing it the reader's scroll position
  would re-run the whole thing on every scroll in order to change a class name.
  So the layouts say what the chain *is* — each `sequence` link names its two
  nodes — and the panel says where the reader is on it. Trail's layout still
  takes `atRow`, for the one reader-dependent thing that is geometry rather than
  styling: a segment carrying an arrowhead is trimmed further back to make room
  for it, so that decision cannot wait for the stylesheet.
- **The hop count is scaled to the chain's length.** A nine-section article and
  a fifty-section one both cover the same range, so the ramp always ends on the
  chain's own weight rather than stopping part-way down. It does not always
  spend all eight steps getting there — three hops come out as 0, 3, 5 — and the
  end is the part that matters. The reach itself is capped at a sixth of the chain, which is the
  rule the plateau this replaced also had and for the same reason: a "you are
  here" covering three fifths of the picture is not a landmark, it is a wash.

**Four defects came out of the review of this, and they are the interesting
part.** GPT Sol read the built code on 2026-08-30
([prompt](../plans/260830ag-v1-diagram-chain-ramp-review-prompt.md),
[answer](../plans/260830ae-v1-diagram-chain-ramp-review-sol.md)); each of these draws
perfectly well when wrong.

- **Trail's ramp ended in the cliff it was designed to remove.** Its chain
  carries *two* fades — how far through the article, and how near the reader —
  and both were plain `opacity` at equal specificity, so the near rules simply
  replaced the progress ones. The ramp's last step, whose whole job is to be
  indistinguishable from no step, painted an early-article segment at 0.52 beside
  an unclassed neighbour at 0.16. The fix is composition rather than replacement:
  the global fade is a custom property and each near step is
  `calc(fade + (1 - fade) × k)`, with `k` reaching 0 at the last one. Force never
  had the problem because its chain has a single base weight, which is exactly
  why a Force-shaped boundary test did not catch it.
- **The arrowhead window was shifted one segment down the article.** A segment
  `i` joins dot `i` to dot `i + 1`, so `|i - here|` calls the link arriving at
  the reader's dot one step further out than the link leaving it. The run had
  heads on both sides and looked symmetric; it was not. The measure is the
  distance to the segment's *nearer* end, which is the same rule `chainNearness`
  uses for a link's level.
- **The heads and the ramp sized themselves off different chains.** The
  arrowheads used every *candidate* segment and the ramp uses the ones actually
  drawn, so a picture with a coincident pair could put a head outside the run —
  27 against 26 is `chainReach` 5 against 4. Trail now decides drawability in a
  first pass and both read that count.
- **Two tests claimed more than they proved**, including one whose comment named
  a probe that would not have reddened. Both were corrected rather than deleted,
  and the reach rule gained a table of its boundary cases, because the test that
  was there would have passed with a constant reach of 4.

The endpoint pair became a **discriminated union** at the same time —
`sequence` requires `from`/`to`, the other four kinds declare them `never`. A
chain link that failed to name its endpoints would not be a line with a missing
field, it would be a break in the chain with the ramp silently stopping either
side of it, and optional fields left a producer one edit away from that.

**It centres on where the reader is standing, not on what they are pointing at.**
Hover moves the footer card and the highlight ring; it deliberately does not move
the ramp. A chain that re-centred under the mouse would stop being a position
readout the moment you tried to read anything else with it.

On Trail the ramp also walks the **hue**, from the chain's violet at the far end
to the marker colour at the reader's feet, and drops out of the additive layer at
the near end. Opacity alone does not separate a hairline from a tangle that is
already glowing, and a bright run left in `plus-lighter` blows out wherever it
crosses the rest of the chain — which is precisely where the reader is looking.

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
[260826n-semantic-search.md](../plans/260826n-semantic-search.md).

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
[260826n-semantic-search.md](../plans/260826n-semantic-search.md). A diagram toggle wanting a
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
itself: sections on Force, single paragraphs on Drift and Trail. The readout
between the buttons (`12 / 47`) is what says which. The step rule itself is
`stepTarget` from `keynav.ts` rather than a second copy, so ↑ here means what ↑
means everywhere: part-way into an item it goes to the top of the item you are
in before it steps back, which is the track-skip rule from every music player.

**On the two scatters the rungs are the article's paragraphs, not the picture's
dots**, and that is a correction made on 2026-08-31. Greg: *"If I press down, it
seems to jump more than one paragraph."* He was right. A dot is one *embedded*
paragraph, and a block under `MIN_WORDS` is never embedded
([`src/article-vectors.ts`](../../src/article-vectors.ts)) — on gwern's scaling
hypothesis the panel's own strip says *84 too short or not prose to place*, and
one press moved the reader two block rows every time. A paragraph with no dot is
still a paragraph the reader is standing in, and the picture already knows which
dot answers for it, because **a dot's range is stretched to tile the article**.
So `paragraphStops` walks the body rows and asks `nodeAt` which dot to light —
the same function the you-are-here mark uses, so the two cannot disagree. What it
gives up is stated where it is given up: on Trail, whose only mark is the lit dot,
two paragraphs sharing a dot make a press that moves the text and not the
picture. Drift gives up nothing, because its line is continuous in the row.

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

**Two rows, not one.** The measured row is where a press steps *from*; a body-only copy of it is
what the mark, the you-are-here line and the readout use. They part company inside the apparatus,
which neither scatter draws: `bodyRowOf` already withheld the line there, but a note stranded
mid-body falls inside a dot's tiled range, so `nodeAt` would light that dot and count the reader as a
paragraph of the argument while the line beside it stayed honest. The readout says `—` there now.
⟨Sol⟩, 2026-08-31.

**A press moves the mark itself rather than waiting to be told.** Every other route into the panel's
idea of where the reader is costs a frame — the press scrolls, the scroll fires, a frame runs, the
row lands — and in a browser that showed as a readout one press behind: six presses of ↓ reading
`9, 10, 10, 12, 12, 14`, each of which had moved the article exactly one paragraph, and the same
block reading `9 / 145` opened directly and `10 / 145` stepped onto. A press is the one case where
the answer is known before the page has moved, because we are the ones moving it. The next
measurement overwrites it, so an interrupted jump corrects itself.

**A press measures the page, and chains.** `readerRow` is React state and is a frame behind at best,
so `stepTo` calls `measureRow()` itself; and because scrolling is animated, the row the last press
aimed at stands for `CHAIN_MS` — keynav.ts's constant, for this exact problem — so two rapid presses
count as two rather than landing half way. The first build asked `glideTarget()` instead and Sol
found the gap: the glide clears its own handle in the same tick as its last `scrollTo`, leaving a
window in which nothing is in flight and the measurement is still mid-air.

**What ends the chain is *where* the gesture landed, not which gesture it was**, and getting that
backwards broke the touch path the buttons exist for. The second build dropped the chain on any
`wheel` or `touchstart` — and on an iPad every tap is a `touchstart`, so the second tap of a rapid
pair cleared the chain a moment before the `click` that wanted it. The test passed throughout,
because `button.click()` fires no touch. Anything outside `.diag-step` ends it now, which also
catches the things neither of those events sees: a scrollbar drag, PageDown, keynav's own arrows, a
click on a dot, the footer card's jump. Sol found both, 2026-08-31;
`tests/diagram-step.test.tsx` holds them.

**And the panel measures where the reader is rather than reading it off `?at=`.**
`?at=` names the *section*, deliberately and for three good reasons
([position.ts](../../src/web/position.ts)), and this panel believed it named the
paragraph. Measured in a browser on 2026-08-31, Drift's you-are-here line sat one
to three paragraphs behind the reading line and then jumped, which is Greg's
third complaint the same day: *"if I click up/down to move paragraphs in the
text, it doesn't update the position correspondingly in the diagram"*. It now
uses `measureRow()` — keynav.ts's, the same one `swipe.ts` calls, because a
finger, a key and a picture drawn against the article must not hold three
different ideas of the reading line. Gated to Drift and Trail: Force's nodes are
sections, so the finer row would move its mark at exactly the same moments while
re-running the 300-tick simulation a dozen times a screen.

**The two big buttons carry no hover card.** They had one each and Greg asked for
them back out on 2026-08-31: *"the tooltip isn't that helpful and gets in the
way"*. It got in the way literally — the card opens upwards over the bottom of
the picture, which is what a reader reaching for these buttons is looking at —
and a downward chevron above a readout saying `12 / 47` had already said it. The
readout keeps its card, because what a press moves *by* is the one thing on this
bar that is not guessable. `tests/diagram-panel-hover.test.tsx` holds both halves,
including that neither button falls back to a `title`.

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

#### And then they sprang back, which was not the picture's fault at all

Greg, 2026-08-30:

> the up/down buttons … don't seem to work very reliably. I press them, something changes, and
> then sometimes it seems to revert back to the active node it was on.

Exactly right, and the cause was one line in a file this panel does not own. `?at=` holds a block id,
and the scroll spy that writes it is **section-granular**
([url-state.md § the unit is a section](url-state.md#the-unit-is-a-section-not-a-position)) — it
compared what it had measured against *the value in the address*. That is
the same question only while every value in the address is a section — and a rung on Trail or Drift
is a **paragraph**. So a press put a paragraph there, the spy computed the enclosing section, found
the two different, and wrote the section's first block back over it when the queued position write
landed. The mark moved and reverted.

It looked like a scatter bug and mostly was one. On a normal three-deep tree Force's rungs and the
spy's sections are the same rows, so nothing sprang back there — but only by coincidence: Force is
capped at depth 2 and the spy uses `leafDepth - 1`, and on a *shallow* depth-2 tree Force's leaves
are paragraphs inside depth-1 sections and it springs back too. Two numbers that agree on the
common case and are not the same number. ⟨Sol⟩, correcting the first write-up of this.

The flicker is the half you can see. The half you can measure is worse: the address was now back at
the top of the section, so the *next* press computed its target from there and landed on the rung it
had just used. Four presses of ↓ in the reproduction land on the same row four times, and that is
what "don't work very reliably" was.

Two things follow, and neither of them is in this file:

- The spy now asks **"is the reader still inside the section the address already names?"** — so a
  finer value a jump put there stands until they leave. `positionToWrite` in
  [`position.ts`](../../src/web/position.ts).
- **A jump of ours in flight writes nothing**, because `glide` animates with `window.scrollTo` on
  every frame and the spy would otherwise name every section the page flew over — which loses the
  target of a click on a distant dot exactly as the first bug lost the target of a button press.
  GPT Sol found that one in review of the fix, before it shipped.

The whole write-up, with the commit that made the assumption false and the four removal probes, is
[260830b-the-spy-wrote-a-section-over-the-paragraph.md](../postmortems/260830b-the-spy-wrote-a-section-over-the-paragraph.md).

And one that is: `DiagramBand` took `?at=` by reading `location.search` at render time, which the
other bands can afford and this one cannot. `jumpTo` writes the URL on the next task, so a second
press inside that window stepped from the stale row. It is a prop now. Same review.

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
is in [the plan](../plans/260826ah-diagram-mode.md#what-the-tests-caught).

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
pixels, and [260827g-embedding-scatter-diagrams.md](../plans/260827g-embedding-scatter-diagrams.md)
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
nothing about any particular pair. So the picture says it in words, not only as a
number — GPT Sol's finding on the plan, and the most important one of the round.
Where those words live is
[the icon on the control row](#the-caveat-is-an-icon-not-a-strip).

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

**The picture says how many were left out**, because one that quietly drops a
fifth of the article looks exactly like a picture of all of it — in the icon's
card, and in an `.sr-only` live region that announces when the projection lands
([below](#the-caveat-is-an-icon-not-a-strip)). One
consequence to own rather than hide: **Trail's chain joins consecutive *dots*,
not consecutive paragraphs**, so a segment can silently bridge a run of list
items nobody drew. What *does*
tile is each dot's row **range**: a dot answers for everything from itself to
just before the next one, so the you-are-here mark never falls in a gap even
though the dots do.

### The caveat is an icon, not a strip

It was a `<p class="diag-note">` above the picture — four lines of 10.5px prose,
about fifty pixels of a 400px band, saying the same thing every time.

> It uses up valuable vertical real estate. Hide it behind a tooltip or warning
> icon or something.
>
> — Greg, 2026-08-30

So it is an `Info` icon at the end of the panel's heading row, carrying the same
words in the panel's own hover card (`ScatterNote` in
[`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx)).

Two things make that a move rather than a deletion, and each is the half a
tooltip on its own would lose:

- **The sentence is still announced.** An `.sr-only` `role="status"` carries the
  whole of it, so a reader who cannot see the picture still learns when the
  projection lands that a fifth of the article is not in it. A card is reached by
  pointing or by Tab; it announces nothing.
- **The counts are in the control's own name**, not only inside the card. "Info"
  is a noun, and a control whose whole accessible name is a noun is one a screen
  reader cannot skim.

`Info` rather than a warning triangle: paragraphs going unplaced is the ordinary
case, and an alarm on the ordinary case is an alarm nobody reads by the second
article.

#### Why the heading row and not the control row

The icon went on `.diag-opts` — the Sideways/Colour strip — first, on the
reasoning that a row already drawn costs nothing to add to. That was wrong, and
it is worth the paragraph because **two separate checks confirmed the absence of
the old wording rather than the truth of the new one**, and both passed.

`.diag-opts` wraps. An auto margin right-aligns an item on the line it lands on;
it does not stop it starting a new one — so the first version's "costs no
height" was simply false. Nesting the chips in an inner wrapping box fixed
*which* item wrapped and not *whether* a line was spent, because the binding
constraint is **total intrinsic width**, not alignment: at the ideal band width
Drift's two chip groups and the icon do not fit on one line, so one of them wraps
however the alignment is written.

The browser sweep that found it (2026-08-31) also shows why the checks missed it.
Drift was measured at its narrowest, where the chips already wrap and the icon
rides free; Trail at its widest, where there is only one chip group and
everything fits. The costly combination — Drift at the ideal width — was in
neither.

`.band-head` has no `flex-wrap`, so it cannot gain a flex line at any width: it
shrinks its heading instead.

**And that argument had the same shape as the two before it — true about the
thing it named, and not the whole story.** A row that cannot gain a flex line
can still get taller, because the flexible item inside it wraps its own text
once it has been shrunk far enough. The only thing stopping that here was that
`.band-head`'s heading is the single unbreakable word "Diagram" — a fact about
today's copy, which would stop being true the moment the heading became two
words. `.band-head h2` now declares `min-width: 0`, `overflow: hidden`,
`text-overflow: ellipsis` and `white-space: nowrap` — since 2026-09-02 for
every band's head, not only this one, which is what the single `.band-head`
family in `styles.css` § mode band is for — and
[`tests/diagram-css.test.ts`](../../tests/diagram-css.test.ts) holds them there.
`min-width: 0` is the load-bearing one: without it a flex item's automatic
minimum is its longest word, so it never shrinks far enough for
`text-overflow` to do anything, and the other three read as present and working.

**Then measured, at last** — 2026-08-31, on a throwaway preview page since
deleted, 96 widths from 180px to 560px in 4px steps. The icon costs no height at any of them, in either
row: `.band-head` is 40.91px shown or hidden, at 288px and at 400px alike, and
`.diag-opts` is 53.77px at 288 and 29.78px at 400 either way — the difference
between those two being the chip groups wrapping on their own, which is what
tells you the icon has genuinely left that row. The heading stays on one line at
every width, and `scrollWidth === clientWidth` throughout, so the ellipsis never
engages: at the narrowest band it wants 57.77px and has 217.4px. The icon takes
24.99px of *width* from it and no height, and cannot raise the row because its
box is 16.19px against the h2's 22.32px line box. That last part is why the
arrangement is robust rather than lucky.

Worth stating which of the four this is: **the first whose claim survives a
sweep**, rather than holding at the widths somebody happened to look at. That is
the whole difference the thread was about.

Three routes to the same extra line, then, found one at a time by three
different people looking at the same claim. The claim is now a property of the
markup rather than a measurement that happened to hold, which is the difference
between fixing this and re-wording it —
[silent-success.md](../reusable/silent-success.md) applies to a *claim in a
comment* exactly as it applies to code. The test written to hold it down
demonstrated the point once more on its way in: it matched the word
`min-width: 0` in the rule's own explanatory comment, so deleting the
declaration left it green.

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
   thick**, fading back into the chain over the next few hops, and the window
   shrinks on a short article so the run stays a landmark rather than becoming
   most of the picture. This is what makes Trail readable *while* scrolling
   rather than only studiable. It was a flat run of seventeen segments with a
   hard edge until 2026-08-30 — see
   [The chain fades outward from the reader](#the-chain-fades-outward-from-the-reader-2026-08-30),
   which is now the same code the Force chain uses;
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
- **Arrowheads are gone from the global chain** and drawn on the local run
  instead — on its inner half since 2026-08-30, because the run's outer steps are
  back at the chain's own weight by then and a head out there is the clutter this
  rule exists to prevent. Two design reviews and the browser pass reached the
  original independently: *direction along a path you cannot trace is not
  information*, and thirty heads through 263 crossings are clutter.
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

## The fourth: Sketch

<a id="sketch"></a>

> I've been disappointed by Diagram mode so far. … the goal is to provide some
> kind of helpful sense of the whole document's structure. … if the writer says
> they're going to make 3 arguments for X, that might be represented as 3
> columns that converge back. … Let the agent decide the layout completely.
>
> — Greg, 2026-08-30

The three pictures above each answer one question with one algorithm, so every
article comes out the same shape. **Sketch has no algorithm**: a model reads the
piece, decides what shape the argument is — a funnel into a convergence, a
priority ladder beside its own elaboration, a spine with asides — and lays it out
itself. On the constitution it drew the four values beside the four body
sections in matching hues, so the reverse-order correspondence is visible without
reading a word. Nothing else here could have found that.

The whole design, the measurements, the review it survived and what a reader who
had not read the articles made of the pictures are in
[260830j-sketch-diagram.md](../plans/260830j-sketch-diagram.md). What follows is what the reader
touches.

### It does not emit SVG, and that is the design

The model writes a **scene** in five primitives with numbers in them —
[`src/sketch-scene.ts`](../../src/sketch-scene.ts) — and the numbers are checked
against the article before anything is drawn. Every `block` id has to exist,
every edge has to name a node this scene has, every path is `M L C Q A Z` with
the right arity, and the picture is *measured*: whether it still runs down the
page with the article, how much of the piece nothing points into, how much of it
is drawn on top of itself, how much text will not fit its shape.

That is what makes it a different answer from the generated image
[§ What is deliberately not here](#not-doing) rejects, rather than the same one
again — *an image of a structure cannot be checked against the structure*, and a
scene can. It is also why this is not the first model-authored markup the app
renders: there still is none.

**The layout really is entirely the model's.** Every position, shape, grouping
and line. What it does not get is the vocabulary, the palette or the type scale,
and a `tone` is a group marker that the stylesheet turns into one of the eight
positional hues through the same `--cat-rgb` indirection everything else uses.

### Where the pieces are

| | |
|---|---|
| the schema, the validator, the score, the acceptance boundary | [`src/sketch-scene.ts`](../../src/sketch-scene.ts) |
| scene → drawing primitives, no DOM | [`src/sketch-paint.ts`](../../src/sketch-paint.ts) |
| the prompt and the model call | [`src/sketch.ts`](../../src/sketch.ts) |
| the panel | [`src/web/SketchView.tsx`](../../src/web/SketchView.tsx), [`useSketch.ts`](../../src/web/useSketch.ts), `§ sketch` in [`styles.css`](../../src/web/styles.css) |
| the harness that renders one offline | [`evals/sketch/`](../../evals/sketch/) |

**One painter, two sinks.** `sketch-paint.ts` is pure and returns primitives;
the panel maps each to an element and hangs the handlers off the nodes, and the
offline harness serialises the same primitives to a standalone `.svg`. A second
painter in the panel would be two answers to one question, and the one that
drifts is the one nobody is looking at when a prompt is being judged.

**Its own component, not a fourth branch of `DiagramPanel`.** The other three
are a `DiagramLayout` and every control under the chips is about it — the roving
tabstop over `layout.nodes`, the step bar over its ladder, the footer card over
a `SummaryNode`. A scene is none of those and has its own. Splitting once, below
the chip row, is what keeps the other three unbraided.

### The scene is checked again in the browser

`readSketch` runs on the server before the artefact is written **and** in
[`useSketch.ts`](../../src/web/useSketch.ts) when it arrives. That is not a
duplicate. What comes back from `/api/sketch/:slug` is a stored artefact that may
have been written by an older schema, or against an article that has since been
re-ingested and has different block ids — so the panel drops what it cannot draw
before drawing anything, and what it drops is the *unreachable*, never the
picture. An unknown block id costs a node its click and leaves the node standing.
The count comes back so the reader can be told the picture is older than the
article, rather than being quietly handed a diagram whose clicks do nothing.

It is the same rule at both ends of a wire that has a database and a year in the
middle of it. The same pass is where a region's door gets *derived* when the
model did not write one, which is why both ends of that wire agree about which
names are pressable without the artefact on disk having to change.

**Reachability is two numbers, and they answer different questions.** A scene
nothing opens is a scene the reader can never get to — the plainest silent
success this feature produced, unnoticed through six runs, and the reason
`score.unreachable` exists at all. But once a link can be inferred, that one
number stops being able to say whether the *prompt* is still working: a picture
whose doors we fitted ourselves scores exactly like one the model wired
properly. So `unreachable` counts what the reader cannot reach, inferred doors
included, and `score.inferred` counts how many of the doors are ours. Watch the
second one: it rising is the prompt quietly giving up on `opens`, and nothing
else would show it.

### What it costs, and what that decides

**One model call, 121–194 seconds, about $0.20** — measured over seven draws of
five articles. That is the slowest single thing in the app and four times the
glossary, and three consequences follow from it rather than from taste:

- **Never the default and never in an ingest.** `sketch` is off
  `DEFAULT_INGEST_STEPS` and in `FORCE_ONLY_WHEN_NAMED`, so nothing sweeps it in.
- **Picking the Sketch chip draws it, if nobody ever has.** Since 2026-09-02,
  and it is the chip's `onClick` that arms it, never `?diagram=` — that is query
  state, so Back and Forward move it, and a pasted
  `?mode=diagram&diagram=sketch` must not buy a two-minute call. *Opening
  Diagram costs nothing*: the mode lands on a picture drawn from the tree, so
  the bar's Diagram button arms nothing at all.
  [`src/web/activation.ts`](../../src/web/activation.ts),
  [`useAutoRun.ts`](../../src/web/useAutoRun.ts), and
  [glossary.md § That decision was reversed](glossary.md#that-decision-was-reversed-on-2026-09-02-and-the-loop-is-still-closed-structurally)
  for the loop it has to close and how. One automatic attempt per article per
  tab session; the button is the only retry.
- **`useSketch` grew a second verb for it.** `ensure` is unforced and is what
  both the automatic draw and the empty state's button call — a forced press
  landing inside the automatic start's window would be a different `work_key`,
  which stage 1 does not de-duplicate, and the reader would pay twice.
  `regenerate` is forced and keeps the reasoning the old single verb had: a
  redraw is offered beside a picture that is current, where an unforced run
  would skip while the reader watched two minutes go by.
- **The empty state says the price before the press**, not after it — a reader
  who presses a button and then watches a spinner for two minutes with no idea
  why is owed the sentence.
- **And a redraw somebody else started still shows.** `useStepJob` reads the
  queue rather than remembering the click, precisely so a run from the CLI, the
  shelf or another tab appears — and this panel was the one surface that did
  nothing with the answer, so a picture already on screen changed under the
  reader two minutes later with nothing having said it would. `.sk-busy` is one
  line with the spinner and the step's own label. Deliberately **not**
  `JobProgress`: that row carries a Stop button and, with no job running, the
  Draw button — and offering a $0.20 redraw beside a picture that is already
  there is a product decision, not a loading state.
  [`tests/sketch-view-drawing.test.tsx`](../../tests/sketch-view-drawing.test.tsx).
- **It is in `FORCE_ONLY_WHEN_NAMED` for a third reason the others do not have**,
  and it is about the clock rather than the money: every step self-aborts at 400s
  inside an 800s invocation that must also fit a `hierarchy` measured at 320s. A
  positional cascade that swept this in beside `hierarchy` would not waste a call, it
  would run the invocation out of time — and that fails as a platform kill that
  takes the whole job rather than as a recorded failure.

**The first converted step, and for a while the only one.** Writing a file inside
`run()` works on a laptop and cannot work through a store that puts the artefact
in a Postgres column. `generateSketch` writes nothing and hands the scene back;
the step returns it as `parts`, and `evals/sketch/run.ts` writes it into a results
directory. Every other article-reading stage followed on
2026-08-31 — [260831b-finish-the-database-move.md § Stage 2](../plans/260831b-finish-the-database-move.md).

### 288px is not a size a diagram fits in, and zooming inside it does not help

The canvas is 760 units and the band is 288–400px, so scaled to fit, 12-unit text
lands at about 5px. The band shows the **shape**, which is what this picture is
for and which survives being small; the words do not, so hovering or focusing
anything puts the full text in the card underneath.

The first answer to the words was a Fit/Read toggle that redrew the picture at its
natural 760 units *inside the same column*. Greg, 2026-08-30:

> Right now it just zooms in, but the column is narrow.

Which is the whole objection. Reading a diagram through a 288px slot by scrolling
it in two directions is worse than not reading it: you lose the shape, which was
the one thing the small version had, and you gain words you have to reassemble
from four screenfuls.

So **Enlarge**, and it is a real modal — the same `<dialog>` `showModal()`
[`Lightbox.tsx`](../../src/web/Lightbox.tsx) uses for a figure in the article, for
the four reasons that file gives: Escape closes it, the background goes `inert`,
focus is trapped and restored, and it paints in the top layer without joining the
z-index budget. Inside, the picture is drawn to the window's width rather than to
760, so the text arrives at 17–20px and the shape is still whole — nothing about
the layout changed, only its scale.

**Widening the column was the other option Greg offered and it is worse.** The
band's width is the output of a negotiation in
[`layout.ts`](../../src/web/layout.ts) between the rail, the band and
`PROSE_MIN`, and a band that grew to fit a diagram would take that width from the
article — which is what the reader is here to read, and what every other rule in
that file protects first. A modal takes it from nothing.

### Interaction

- **Click a node** → if it has an `opens`, the picture zooms into that scene;
  otherwise the article jumps to its block. **`opens` wins**, because the
  picture's own gesture is "go deeper" and a click that sometimes zoomed and
  sometimes scrolled the article would be a control nobody can predict. The jump
  is still there, from the card, where it is labelled — available and never a
  surprise.
- **A part that opens says so, and shows what is inside it.** A zoomable region
  is drawn *hotter* than one that is not — a brighter edge, a stronger wash, on
  its own panel. Contrast rather than a second shape, because the band scales
  760 units into under 400 pixels and every **distance** halves with it: the
  first version was a second panel offset five units behind the first, which is
  two and a half pixels, and a browser pass could not see it at all. Beside the
  name there is an "expand" corner mark, held at a constant stroke weight so it
  is the same line in the band as at full screen. Hover or focus the name and
  the scene it opens is
  drawn *inside that region*, small, over a scrim — the real scene, painted by
  `paintScene` into a nested viewport, with only the words dropped. Press it and
  the new scene grows out of the box you pressed; Back reverses the same motion.
  All of it is [260830ap-sketch-zoomable-subsections.md](../plans/260830ap-sketch-zoomable-subsections.md),
  including why the ghost is not a simplified redraw and why the swap happens
  before the animation rather than after it.
- **Click a region's name** — "WHY WE'RE TEMPTED TO SEE IT" — and the picture
  opens the zoom scene for that part. Greg asked for it by example, and it is the
  most natural handle there is: a region is the overview's own statement that
  these boxes are one movement of the piece, and the zoom is that movement drawn
  larger, so a reader pressing the name is pointing at exactly what they want
  more of. **The name, never the panel**: a region is a large area lying *behind*
  the nodes, and making all of it pressable would put a second meaning on every
  pixel between the boxes.
- **The name is pressable even when the model never said so.** Greg pressed
  "WHY WE'RE TEMPTED TO SEE IT" and nothing happened: that drawing was made
  before the prompt asked for `opens`, and the region carried none. Redrawing
  costs $0.20 and fixes one article, leaving every reader holding an older
  sketch pressing names that do nothing — so the link is *derived* instead.
  `inferRegionOpens` in [`src/sketch-scene.ts`](../../src/sketch-scene.ts) reads
  the blocks under the region and the blocks in each zoom scene, and joins them
  when one scene takes a strict majority of the region's and the runner-up takes
  at most half of that. It is deliberately shy — **a wrong door is worse than
  none**, because a reader who presses a name and lands somewhere else has been
  lied to by the picture, where one who presses a name and gets nothing has
  learnt only that this name is not a control. On the six regions of the two
  real drawings it links three and abstains on three, and all six are right. Not
  string similarity: "THE CORE ARGUMENT" and "Why Scale Works: The Ladder" share
  no word, and their blocks match five to nil. A link the model wrote is never
  overruled, and a derived one is **not saved**: `stripInferredOpens` takes it
  back out before the artefact is written, so the stored picture stays the
  model's own work and the derivation runs afresh on every read — which is also
  how a better rule tomorrow reaches every sketch already on disk. A derived one
  is marked `opensInferred` — see
  [§ The scene is checked again in the browser](#the-scene-is-checked-again-in-the-browser)
  for why the score then needs two numbers rather than one.
- **Back** appears whenever a zoom is open, and Escape does the same. The scene
  row beside it is the other way around the picture — Back is out of where you
  are, the row is a list of where you could be — and neither depends on the model
  having wired an `opens`, which on four of the first six drawings it had not.
- **Hover or focus** → the card below. Fixed height, like `.diag-card` and for
  the same reason: a card that grew with its text would resize the picture above
  it every time the pointer crossed a box.
- **Keyboard** → one tab stop, arrows inside it, Enter activates. A `listbox` of
  `option`s rather than a `tree`, for the reason Drift and Trail are: a scene is
  not a hierarchy and there is nothing to open.
- **Where you are** is a ring on the deepest node at or above the reader's row,
  and only on the overview — marking a position inside a zoom scene when the
  reader is elsewhere would be a confident lie about where they are.

### The shapes make claims, and the prompt says so

The failure this picture has that none of the other three can: **it asserts
things through its geometry that nobody wrote in words, and those assertions can
be stronger than the article's.** Found twice by readers shown only the pictures
— a numbered priority ladder on a document that says its order is "holistic
rather than strict", and a decision diamond on a question the essay says cannot
be settled. Neither was a wrong fact; both were the shape being more confident
than the prose, and a reader cannot tell a confident drawing from a correct one.

`SYSTEM` in [`src/sketch.ts`](../../src/sketch.ts) now names what each device
claims, before the canvas and before the primitives, and asks the model to check
each shape it used against the article. It is the most load-bearing section of
that prompt.

## The fifth: Illustrated

<a id="illustrated"></a>

> It should use the latest OpenAI Images image-generation model to generate a
> more engaging version of Sketch, based on the data from Sketch. … it could
> illustrate it like those old-timey maps that had little pictures and
> illustrations, or monk-illustrated copies of fancy books pre-printing-press. …
> Most importantly, it should restrict itself to what's in the article.
>
> — Greg, 2026-09-03

Sketch decides what shape the argument is and draws it in boxes. **Illustrated
takes that same scene and has it painted.** Two calls: a model reads the article
and the scene and writes an illustration brief, and `openai/gpt-image-2` draws
the brief. On the Anil Seth essay it chose an illuminated manuscript page and
said why —

> the essay itself invokes golems, Scala Naturae, souls and psychē — vellum,
> gold leaf, and marginalia are the article's own idiom, not an imported one

— and drew the Scala Naturae ladder, the hallucinated relative at the foot of
the bed, and Mother Teresa's face in a cinnamon bun. On the constitution it chose
an antique route-chart instead, because that article is a governing text rather
than a cosmology. The two cannot be swapped, which was the acceptance test.

The whole design, every measured number, and the four things it deliberately does
*not* do are in
[260903c-illustrated-diagram-sub-mode.md](../plans/260903c-illustrated-diagram-sub-mode.md).
What follows is what a reader touches and the three facts that decide everything
else.

### It is an interpretation, and the app says so

**This is the one picture here that cannot be checked**, and
[§ What is deliberately not here](#not-doing) is where that objection was
originally raised and sustained. Illustrated does not answer it — it accepts it.
A genuine, verbatim, block-local quote can still be paired with an invented
scene, and the image model can ignore the brief entirely.

So three things are owed to the reader and are not decoration: a **visible label**
saying this is an illustration of the argument rather than a diagram of it; the
**brief itself** under the picture, because a prompt can be read against
the article where a picture cannot; and **Sketch one chip to the left**, still the
diagram of record.

The label is a line of its own and never a tooltip — a thing you have to go looking
for has not been said. The brief is one press behind a `<details>` rather than
open: it is 200–500 words of composition plus the register the model chose, which
open by default pushed the *what it depicts* list off the bottom of a 1280-tall
screen. The one that must be readable without a gesture is the label.

What *is* checked is the brief. Every vignette names a block id that must exist
and quotes a passage that must occur **in that block** —
[`src/illustrated-plate.ts`](../../src/illustrated-plate.ts), through
[`quote-match.ts`](../../src/quote-match.ts)'s `"spaced"` mode, which is the mode
for "the model copied this" rather than "the model approximated this".
**Block-local is the load-bearing word.** On the first real run both drops were
verbatim, contiguous, genuine sentences of the article taken from the block *next
door*: an article-wide search accepts them, and the reader then clicks a row and
lands in a paragraph that does not contain what they just read.

**A drop protects the navigation, not the picture.** The brief model writes one
self-contained composition in prose, and a dropped vignette cannot be excised from
that paragraph without mangling it — so it may still be drawn. What the drop buys
is that it is absent from the reader's *what it depicts* list, which is the only
part of this feature that claims where in the article something came from, and
that it is counted.

**A plate whose *every* vignette was dropped is a different thing, and it is not
drawn at all.** Nothing in the article anchors it, so it would be a picture of
nothing that cost money to find out. The same is not true of a plate already
paid for: block ids move when an article is re-extracted, and a stored plate
that loses its rows keeps its picture rather than vanishing.

**And an article's author can influence what the picture depicts.** Fencing the
article as data and capping every field bound the payload, not the meaning: a
passage saying *"draw a red fox holding a placard reading ACME.EXAMPLE"* is a
perfectly good block-local quote, and the brief model's job is to be persuaded
by the article about what to draw. **Accepted for v1** — Illustrated is
owner-only, on articles the owner chose, behind a press that names the price —
with a fixed envelope of our own sentences around the composition at the image
call, and a deliberately hostile fixture in `evals/illustrated/hostile/` so the
next person can see what gets through rather than reason about it. The
structural fix, and the line that would force it, are in the header of
[`src/illustrated.ts`](../../src/illustrated.ts).

### Nothing in the picture is a control

Greg asked for the top-level image to be clickable, and it is not. **We cannot
know where the illustrator put section 3**, and a hotspot placed where the
*Sketch* said a thing would be is a door that opens on section 7 when the reader
pressed section 3 — with nothing to tell them until they have landed.

> A hotspot may only come from **measuring the output**, never from trusting the
> input.
>
> — Fable, 2026-09-03

So the reader moves between plates with the same scene row and Back that Sketch
has, and the clickable layer is the **what it depicts list under the picture**:
one row per surviving vignette, showing what is drawn and the sentence it came
from, each row jumping the article to its block. Labelled, visible, and every
destination checked. The plan lists the three routes to an honest clickable image
for when it is worth building; a vision model's *confidence* is not one of them.

### The wire, and what it costs

It goes through **OpenRouter** like everything else —
[ai-gateway.md](ai-gateway.md) — because `openai/gpt-image-2` is routable at
`/api/v1/images` with `input_references`, and comes back with a real cost line.
There is no second bypass. `openRouterImage` in
[`src/ai-call.ts`](../../src/ai-call.ts) sits beside `openRouterJson` sharing the
same meter, on a `wire` of `"images"` — which is a **column on the route table**
since 2026-09-03, because it used to be derived from the path by a binary test
that would have recorded every plate as a chat call.

**The brief call is the bill and the pictures are not**, which is the opposite of
every intuition about this feature: measured across three articles at **$0.23–$0.38
an article, 80–88% of it the brief**, against Sketch's $0.20. Worst case 417 s
inside a 760 s lease. The numbers, per article and per plate, are in
[`evals/results/illustrated-v2b/README.md`](../../evals/results/illustrated-v2b/README.md),
and the before-and-after of the prompt that produced them is
[§ Tuning the prompt](../plans/260903c-illustrated-diagram-sub-mode.md#tuning-the-prompt-illustrated2).

Plates are asked for as JPEG (`output_format`, which the model honours despite not
advertising it) and stored content-addressed in the blob store, never base64 in
the artefact. A plate's media type is decided **from the signature, never from
what the provider claimed**, and
[`src/illustrated-image.ts`](../../src/illustrated-image.ts) refuses to store
anything that is not `image/jpeg` — a `.jpeg` object that is not one is the
failure a future model silently ignoring `output_format` would cause.

### Where the pieces are, and the two things that are unlike every other mode

| | |
|---|---|
| the brief's schema and its two readers | [`src/illustrated-plate.ts`](../../src/illustrated-plate.ts) |
| the two calls, and what it was painted from | [`src/illustrated.ts`](../../src/illustrated.ts) |
| a plate's bytes, validated and content-addressed | [`src/illustrated-image.ts`](../../src/illustrated-image.ts) |
| the step | `illustrated` in [`src/pipeline.ts`](../../src/pipeline.ts) |
| the routes | `/api/illustrated/:slug` and `/api/illustrated/:slug/:hash.jpeg`, [`src/routes.ts`](../../src/routes.ts) |
| the read, and whether the button would be refused | [`src/web/useIllustrated.ts`](../../src/web/useIllustrated.ts) |
| the plate, the plate row, Enlarge, and the *what it depicts* list | [`src/web/IllustratedView.tsx`](../../src/web/IllustratedView.tsx) |
| the harness that paints one offline | [`evals/illustrated/`](../../evals/illustrated/) |

**It is the only step whose input is another step's artefact**, and that has two
consequences worth knowing before touching either.

**It refuses rather than pulls.** `useStepJob` posts `steps: [step]` and pipeline
order does not put a prerequisite in front of it, so a run whose Sketch is
**absent, stale, or drawn for a different reader profile** fails with a sentence
ending *"Draw the Sketch first — it is the chip one to the left"* — always before
the brief call, so nothing is spent finding out. Not
`enqueue(["sketch", "illustrated"])`, which turns one press into a hidden $0.20
charge and a three-minute wait that nothing warned about.

Stale and wrong-profile are refused for reasons of their own. A picture painted
from a stale Sketch is **born stale**, because the panel's `stale` covers the
Sketch's staleness too — $0.30 for something labelled out of date the moment it
lands. And a Sketch drawn for somebody else's profile would loop: the picture
inherits its `profileHash`, the route answers `profileChanged`, the panel offers
to paint again, and the next paint inherits the same hash. All three checks are
in `run` and none is in `stamp`, which is the difference between *would we paint
this again* and *may we paint it now*: a finished illustration whose Sketch has
since drifted stays done, so nothing re-runs on its own and the sentence only
appears when somebody asked.

**Its freshness is about the Sketch, not the article** —
[`inputFingerprint`](../../src/illustrated.ts). A forced Sketch redraw changes
the scene with every article byte identical, so an article-shaped fingerprint
would leave a stale illustration reporting itself current. `profileHash` is
inherited from that Sketch for the matching reason: a picture painted from a
personalised Sketch is personalised, and an owner about to publish is owed that
fact. The panel's `stale` is the wider of the two questions — it is true when
the Sketch has moved **or** when the Sketch has itself gone stale against the
article, because a picture two hops from the piece is not current either.

**The plate route never takes a key from the path.** Plates live in a
content-addressed store shared by every article and every reader, so the hash in
the URL is used only to look a plate up in *this* article's own artefact, and
the key handed to the store is rebuilt from what we wrote —
[security.md](security.md) owns that rule.

**Orphan blobs are accepted and no sweep is built.** The store is
content-addressed and create-only, so a run that draws two plates and then fails
leaves two objects nothing references. They cost about 150 KB each, the next
identical run dedups straight onto them, and a garbage collector over
content-addressed blobs has to be right about every artefact in every revision
that could still hold a hash — getting that wrong deletes a picture somebody is
looking at. Named here so the next person knows it was decided rather than
forgotten.

## What is deliberately not here

<a id="not-doing"></a>

- **A generated image, and it is [Illustrated](#illustrated) — reversed on
  2026-09-03, on Greg's ask.** What stood here said no: not interactive, a model
  call per article, and — the serious one — an image of a structure cannot be
  checked against the structure. A picture that puts section 4 inside section 3
  is wrong in a way that looks exactly like being right
  ([silent-success.md](../reusable/silent-success.md)).
  **Two of those three still stand and the fifth picture concedes them**; it is a
  second picture of the same argument and never a replacement for the first.
  The line that has not moved is that
  [Sketch](#sketch) remains the *checkable* diagram of record.
  The other good use named here is still unbuilt and still a different feature: a
  static, shareable image of an article's shape — a thumbnail, an OG image.
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
  the recipe that made them. When [260826n-semantic-search.md](../plans/260826n-semantic-search.md)
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
  positional and a re-run of `npm run hierarchy` renumbers them
  ([block-ids.md](block-ids.md)), so a pasted link would open the wrong sections
  on an article that had been re-ingested. A link that is quietly wrong is worse
  than a link that carries less.
