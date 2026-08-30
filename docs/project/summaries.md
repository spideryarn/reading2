# Summaries — the article at whichever length you ask for

**Built 2026-08-26.** A **mode** in the band between the spine and the prose: the whole article, each
of its parts and each of its sections, every one of them at a length the reader chooses with one
control. Press `Summary` in the bottom bar.

Greg's ask:

> Add functionality for hierarchical Summary, taking inspiration from
> `docs/project/original-version/` … When active, it should replace the middle sections of the UI
> (i.e. right of the spine, left of the doc).
>
> — Greg, 2026-08-26

and, when shown three possible readings of "hierarchical" and asked to pick:

> Follow the approach the old-version took.
>
> — Greg, 2026-08-26

That settled it. Their approach is a **named length ladder**, and what is hierarchical about it here
is *where the ladder is wired* — see [The ladder](#the-ladder) below, and
[original-version/summaries.md](original-version/summaries.md) for the version this is taken from.

Code: [`src/summarise.ts`](../../src/summarise.ts) (the stage),
[`src/web/SummaryPanel.tsx`](../../src/web/SummaryPanel.tsx) (the panel),
[`src/web/useSummaries.ts`](../../src/web/useSummaries.ts) (the fetch),
[`buildSummaryTree`](../../src/web/tree.ts) in `src/web/tree.ts` (the join), and
`§ summary mode` at the end of [`src/web/styles.css`](../../src/web/styles.css).

```
 ┌── spine ──┬─────── SUMMARY (the mode band) ───────┬────── the article ──────┐
 │           │                                       │                         │
 │  ▇▇▇▇▇▇▇  │  SUMMARY                              │  Being You opens with   │
 │  ▇▇▇▇     │  LENGTH  gist · short · long          │  a story about waking   │
 │  ▇▇▇      │  DEPTH   article · parts · sections   │  from anaesthesia, and  │
 │  ▇▇▇▇▇▇   │ ───────────────────────────────────── │  what that tells us     │
 │  ▇▇       │  Consciousness is not a picture of    │  about the self.        │
 │  ▇▇▇▇     │  the world but a controlled guess     │                         │
 │  ▇▇▇      │  about the body making it.            │  Every paragraph stays  │
 │  ▇▇▇▇▇    │                                       │  exactly where it was.  │
 │  ▇▇       │  ▾ 1  What feeling is for       18¶   │                         │
 │  ▇▇▇▇▇▇▇  │      Perception runs outwards from    │  Clicking a title       │
 │  ▇▇▇      │      the body's own predictions…      │  scrolls the article ┐  │
 │  ▇▇▇▇     │    ▸ 1.1 The body as a model     6¶   │  to that section.    │  │
 │  ▇▇       │    ▸ 1.2 Why colour is a guess   5¶   │                      ▼  │
 │           │                                       │                         │
 │           │  ▸ 2  The hard problem, dissolved     │                         │
 │           │     +4 sections  ← opens just this one │                         │
 └───────────┴───────────────────────────────────────┴─────────────────────────┘
      where you are        the mode band                 what you are reading
```

## The ladder

Three rungs. **Two of them are generated; the shortest one is free.**

| Rung | What it is | Where it comes from |
|---|---|---|
| `gist` | one sentence | the tree node — stage 4 already wrote it |
| `short` | a few sentences | `summary.json`, stage 5e |
| `long` | a paragraph for a section, a couple for a part, about a page for the article | `summary.json`, stage 5e |

Two things about this are theirs and both are worth stating:

**They are named, not numbered.** *"Sentence or two" is a thing a writer can aim at and a reader can
recognise; "level 4" is not.* That runs all the way down to the URL — `?len=long` says what it will
show you and `?len=2` would not — and all the way up into the prompt, which asks for a *kind of
line* rather than a token count.

**The steps are uneven, on purpose.** Theirs ran 10, 15, 25, 30, 50, 100, 200, 400, 800 tokens: fine
at the bottom and roughly geometric at the top. That is a real finding about where the useful
distinctions are, and it is direct evidence for [Q4](open-questions.md) — discrete levels, unevenly
spaced, chosen by what they can express.

The `long` rung is where their **adaptive instruction** lives, which our review of their prompt calls
the more useful half of it:

> Adjust the length of your summary appropriately, based on the length and complexity of the text.
> For example, if the text is a paragraph, write a sentence or two. If it's a page, write a paragraph
> or so. If it's a book, write a page.

That is a **ratio** rather than a length, and it is what makes one control sensible across a whole
tree. It is implemented as a table of named lengths per depth (`rungsFor` in
[`src/summarise.ts`](../../src/summarise.ts)) rather than as that sentence in the prompt, because a
named target is a thing a model can hit and "appropriately" is not.

### Why the shortest rung is free, and why that matters

Every internal node already carries a one-sentence `gist` from stage 4. So **summary mode works on an
article nobody has spent a model call on**: you get the whole outline at one sentence a node, and the
button at the bottom of the panel buys the two longer rungs. That is the difference between a mode
with an empty state and a mode with an upgrade, and it is why `gist` is the default in
[`params.ts`](../../src/web/params.ts).

It is also why this stage does **not** regenerate the gist. Two files each claiming to hold the
one-sentence version of a section is the second-copy-of-one-fact problem; they can only ever
disagree.

## The hierarchy, and the gap it fills

Their ladder had nine rungs and was wired to almost nothing. The place a reader actually met a
summary over there was a heading tooltip, and that tooltip had
`const TOOLTIP_GRANULARITY = 'single short paragraph'` hardcoded into it:

> Nine granularities generated, one shown where it mattered most. Nobody ever wired the ladder to the
> place a reader actually meets it.
>
> — [original-version/summaries.md](original-version/summaries.md)

So here the ladder is wired to **every level of the tree at once**. One control moves the article,
its parts and its sections together. That is the whole of what "hierarchical" means in this feature:
not a second axis, not a second slider — the same ladder, applied everywhere, so that "more detail"
and "further down" stay one idea rather than two ([granularity-zoom.md](granularity-zoom.md)).

The panel's second control is the **depth cut-off**, taken from their structure panel — the one
control that view had, and the one thing it proved: *one control, whole-document granularity* is
usable. See [original-version/structure-panel.md](original-version/structure-panel.md).

### Three ways to be hidden, and they are not one variable

The one design note worth copying from their structure panel verbatim:

> *"too deep to show"* and *"I closed this"* are different states and should not share a variable.

So `deep` removes a whole level and `closed` is a set the reader put nodes into, and the two compose.
A node hidden by the cut-off does not quietly un-close itself when the cut-off moves. The `+N
sections` badge is theirs too, capped at `99+` and suppressed at zero exactly as their reviewer asked
for.

There is a third state since **2026-08-27**, and it is that same note applied once more. Greg:

> when it has collapsed more granular levels, the only way to see the more granular levels is to
> switch articles -> parts -> sections. Could we make it easier to see them for this part of the doc
> (e.g. click `+N sections` to expand those, and click the parent again to collapse)?
>
> — Greg, 2026-08-27

He is describing the cost of a single whole-document control, which is the thing their structure
panel proved *and* the thing it never solved: at `parts`, wanting one part's sections means giving
every other part's sections to yourself as well, and then scrolling past them.

So the badge is now a **control in every case**, and `opened` is the set of nodes the reader opened
past the cut-off. The objection that kept it a mere fact — *pressing it would silently overrule the
Depth buttons above it* — is answered by making the override its own variable rather than by moving
the cut-off: the Depth pills stay exactly where the reader put them, every other part stays shut, and
what changed is one node. The twist beside the part's title is the same control the other way round,
which is Greg's "click the parent again to collapse".

The three compose and none of them rewrites another. Collapsing always clears the override, so
`closed` and `opened` can never both hold the same id — which matters because the reader can reach
that state by hand: open a part past the cut-off, raise Depth, close it there, drop Depth back. A
version with one set gets stuck there and the badge does nothing at all. `tests/summary-expand.test.tsx`
is that sequence.

All three feed exactly one function, [`showsChildren`](../../src/web/tree.ts), because the panel and
the follow both need the answer and a rule written twice will eventually disagree with itself —
silently, since a scroll to a row that is not on screen moves nothing and reports nothing
([silent-success.md](../reusable/silent-success.md)).

The badge also uses the Depth control's own words now — `+2 parts` under the article, `+3 sections`
under a part — rather than saying "sections" at every level. It opens what those buttons name, so it
had better use their word.

**The root is the one row where the badge stays a fact**, and GPT Sol's review is what found it: the
root draws no title row, so it has no twist, so an override written there could never be taken off
again. Pressing `+5 parts` at the `article` cut-off would have left the `article` button no longer
meaning *the whole article, and nothing under it* for the rest of the session, with no control
anywhere on screen to put it back. Leaving Summary mode was the only reset.

That is the right answer rather than a missing feature, which is the part worth writing down. What
the badge is *for* is picking one node out of several without moving the cut-off for the rest. At the
root there are no others: the only thing it could do is exactly what the `parts` button one inch
above it does, reversibly. So there it goes back to naming the control that does the job — *"Press
parts above to see these"*.

Two things the same review got right about the badge as a control, both since fixed:

- **It is named for the node it opens.** `+3 sections` is what the eye needs beside a title it can
  see; a screen reader's button list has no such context, and four of these in a row were four
  indistinguishable controls. The accessible name is now *"Open the 3 sections of Framing The
  Question"*.
- **It hands the keyboard to the twist as it goes.** The badge unmounts the moment the children are
  open — its job is done — and a focused button that disappears drops focus onto `document.body`,
  which loses a screen reader's place in the outline entirely. Focus moves to the twist, which stays
  mounted and now reads *"Close Framing The Question"*. Only when the badge actually had focus —
  which is not the same as "only from the keyboard", and the first version of this note said it was.
  Chrome focuses a button on mousedown, so a real mouse press hands over too, and should: the reader
  was on the badge, the badge is gone, the twist is where they now are. No ring paints, because
  `:focus-visible` is false for a mouse-originated focus — the browser draws that line better than we
  can. What the check is for is never dragging focus off something the reader was actually using.
  Confirmed in Chrome, 2026-08-28: a scripted `.click()` does not focus the button, so the first
  browser pass saw the guard read false and reported a distinction that does not exist.

The paragraph count on every row (`18¶`) is the other half of that borrowing, and it answers a
question our gist columns cannot: *how much am I not seeing?* A section holding forty paragraphs and
one holding three look identical in an L2 cell. This is item 5 on
[the borrow list](original-version/borrow-list.md).

## What is generated, and what it costs

`data/<slug>/summary.json`, written by `npm run summarise -- data/<slug>` or by
`POST /api/jobs { slug, steps: ["summary"] }`. Like `tweets` and `glossary` it is in `STEP_ORDER` and
**not** in `DEFAULT_INGEST_STEPS` — adding an article does not write summaries, because this is a
thing you go to rather than a thing that makes the article readable
([ingest-queue.md](ingest-queue.md), [architecture.md](architecture.md)).

**Which nodes earn one:** the root always, plus every node down to depth 2 that covers at least three
blocks. The test is what a node *covers*, not whether it has children — "has children" reads as a way
of saying "is not a leaf" and is one, right up until a part has no sub-sections, at which point it
silently loses its summary for a reason unrelated to how much text is under it. A leaf is one block
by construction ([validate-tree.ts](../../src/validate-tree.ts)), so the span test excludes leaves on
its own. That short-section cut-off is their adaptive instruction applied as a *whether* rather than
only as a *how long*: a two-paragraph section summarised in a paragraph is a retelling, not a summary,
and its gist already says it better.

**Batching:** one call per parent, covering all its children at both rungs. Theirs costed nine
parallel calls with prompt caching against one call returning all nine as JSON and found the single
call about **89% cheaper** with no caching machinery to coordinate. Ours generalises that shape, and
it buys a second thing theirs did not need — siblings written together can be told to distinguish
themselves from each other, which is exactly [what a row is for](table-of-contents.md). Siblings
written in isolation cannot honour that rule at all.

The batches are capped at eight and run three at a time. The cap is because their glossary's
production 504s were caused by **output** tokens, not by the article going in
([original-version/glossary.md](original-version/glossary.md)); the concurrency is because a
seven-part article otherwise takes seven model calls end to end.

Roughly: a 30-node tree comes to about 20k output tokens across half a dozen calls, a minute or two
of wall clock. Cached on the article's fingerprint (`hashBlocks`,
[source-hash.ts](../../src/source-hash.ts)) plus the prompt version and the model id, so it is written
once and never again unless one of those three moves. **Theirs were never cached at all** and were
regenerated on every page view; their own doc lists that as a limitation.

### Partial salvage, which is the one thing we do differently

Their handler parsed one JSON blob, validated it whole with Zod, and threw on any failure — **eight
good summaries discarded because the ninth was malformed** — and there was no retry loop anywhere in
that codebase for model output. Here:

- a batch that will not parse is retried **once**, with the parse error handed back to the model;
- a batch that fails twice loses only its own sections;
- an entry that cannot be matched to a section is dropped alone;
- and `Summaries.missing` counts what did not survive, so a half-written artefact cannot read as a
  whole one.

That last point is the one with teeth on the client too. A section with no `long` falls back **down**
the ladder to its `short`, and the panel marks the row with the rung it actually landed on. Without
the mark, a fallback looks exactly like a section the model had less to say about — which is
[silent success](../reusable/silent-success.md) in its purest form.

It never falls **up**. Showing a paragraph where a sentence was asked for would break the one promise
the control makes.

### Matching an answer back to the sections it is about

The model echoes both the section's number and its title, and the match uses **title first, number
second**. [`src/arc.ts`](../../src/arc.ts) refuses to zip its answer to the parts at all, for a good
reason: a model that skips one sentence puts every later sentence against the wrong part, and each of
those cells still looks perfectly plausible. Echoing the number makes a skipped entry harmless; the
title is what breaks the tie when the two disagree, because the title is about the section and the
number is only about the list. Anything matching neither is dropped rather than guessed at.

### Anchored by range, never by node id

Entries carry a **block range**, not a node id, and are joined back onto the tree by that range at
load time — the same rule and the same reasoning as the arc. Node ids are positional, so a re-run of
`npm run toc` renumbers them and an id join would hand every summary to its neighbour. See
[block-ids.md](block-ids.md). An entry whose range matches nothing is dropped.

It is a separate artefact rather than fields on the tree for the same reason the arc is:
`tree.json` belongs to stage 4 and a re-run rewrites it wholesale.

## The URL

| Parameter | Values | History | Why |
|---|---|---|---|
| `mode=summary` | | push | A mode is where you are, not a glance — [url-state.md](url-state.md) |
| `len` | `gist` (default), `short`, `long` | push | Changing how much summary you are reading is a deliberate act on the view, like `cols` and `text` |
| `deep` | `0`, `1` (default), `2` | push | Same |

**Per-node open/closed is deliberately *not* in the URL**, and
[structure-panel.md](original-version/structure-panel.md) says their version regretted exactly that.
The honest version of their point: the only way to write that set down is a list of node ids, node
ids are positional, and a re-run of `npm run toc` renumbers them — so a shared link would open a set
of sections that are no longer the ones you opened. It would be long *and* quietly wrong. The depth
is the stable half, so the depth is what a link carries.

## A summary is a door

**Added 2026-08-26, the same day the rest of it landed.** Greg:

> Add block-ids to the summary output (make them clickable, to scroll the text there, and also with
> rich-tooltips).
>
> And make it easier to click a section in the summary (right now you have to click the
> section-title).
>
> — Greg, 2026-08-26

The two asks are one idea from two sides. This whole feature sits one inch from the thing
[vision.md](vision.md) forbids — *"instead of trying to make things too easy, trying to replace the
words with quick and easy summaries"* — and the difference between a summary that augments reading
and one that replaces it is entirely whether you can get from the summary back into the passage
without effort. Ids are the door; a bigger click target is the handle.

### The ids

Two kinds, and they arrive by different routes.

| What | Where it comes from | Present when |
|---|---|---|
| **The citations inside the prose** — `[spya-k3m9qt]` after a claim | the model, because [`textOf`](../../src/summarise.ts) now labels every paragraph it is shown with its id | `short` and `long`, written by `summary/2` or later |
| **The section's range** under each entry | the tree, already there | always, every rung |

The range earns its place precisely because the citations do not always exist. `gist` is the
**default** rung, gists are written by stage 4 which knows nothing about any of this, and most
articles have never had a model call for the other two — so without the range the ordinary case would
have no ids on screen at all. It is the same `<BlockRange>` a gist cell carries in
[`TableView.tsx`](../../src/web/TableView.tsx), in the same position, for the same reason.

Both are drawn by [`Cited.tsx`](../../src/web/Cited.tsx) and
[`BlockRef.tsx`](../../src/web/BlockRef.tsx), which are shared with chat rather than copied. **Two
copies of "what a citation looks like and what hovering one shows" would drift**, and the day they
drift is the day a chip means something slightly different depending on which band it is in. The
rules for what counts as an id and what happens to one the article does not have live in
[`citations.ts`](../../src/web/citations.ts), DOM-free and tested; an unknown id is rendered as
**plain text, never as a link that goes nowhere** — a dead chip is worse than visible noise, because
the reader presses it, the page does not move, and nothing distinguishes that from a bug in the
scrolling.

The hover card is the paragraph itself, truncated. Enough to see whether the section says what the
summary claims; not enough to read instead of going there. That check — the model against the
article, without leaving the sentence you are on — is the whole justification for generating any of
this.

### What the citations cost the prompt, and what stops them taking over

An id after every clause is not scholarship, it is noise, and noise is what a reader stops reading.
So the prompt asks for **one or two in a `short`, at most one a sentence in a `long`**, and forbids a
list of sources at the end. There is no code enforcing that; it is a prompt rule, and it is the sort
of prompt rule that decays quietly.

Which is why [`countCitations`](../../src/summarise.ts) puts two numbers in the step's log line:

| Field | What it means | Why it is there |
|---|---|---|
| `cited` | block ids across every entry | A run that starts reporting **0** is the model having stopped citing. Nothing breaks: the panel renders prose, and the summaries quietly go back to being a substitute for the passage rather than a way into it. |
| `unknownCited` | of those, ids this article does not have | An invented id is a door into the wrong room. The client drops it silently, so this is where anybody would find out it was happening. |

Neither is an error. Both are [silent-success](../reusable/silent-success.md) counters, and the same
pair chat keeps for the same reason.

### The click target

The title was a bad target and it is worth saying why: it is one line of 0.82rem text as wide as the
heading happens to be, so a two-word section is a two-centimetre target inside a panel four times
that wide. The number beside it, the paragraph count, the summary itself and all the whitespace
looked exactly as pressable and did nothing.

Now the whole entry — header, summary and range together — is the target, which is what the gist
cells in the table have always done with a whole `<td>`. Two things keep that honest:

- **The keyboard path is unchanged.** The title is still a real `<button>`; tab reaches it, Enter
  jumps. The `<div>` adds mouse area, not a second way to operate the panel. That is what its two
  `biome-ignore` lines say, and it is a statement rather than a shrug — a `role="button"` there would
  be worse than nothing, claiming to be one control while containing three and taking the twist out
  of the tab order.
- **Anything that is itself pressable wins.** The handler bows out when the click landed on a button
  or a link, so opening a section does not also scroll the article, and a block id goes to *its*
  paragraph rather than to the top of the section it is in.

## Following the reader

**Added 2026-08-26.** Greg:

> If I'm in "Summary" mode, can we highlight and scroll to the relevant Summary section that
> corresponds to the current position of the text?

Two halves, and the interesting one is the second.

### Which row is "the relevant one"

The panel already marked the reader's position: `here` runs the **whole chain** of ancestors, and
that is deliberate — at a shallow depth cut-off the part you are inside is the honest answer to
*where am I*, and marking only the innermost node would leave the panel with nothing lit whenever the
cut-off sits above it.

But there is only one row to scroll to, and a mark strong enough to find at a glance is a stripe down
the whole panel if it is repeated on four nested rows. So there is a second, stronger mark, `now`,
and it goes on exactly one row: [`currentEntryId`](../../src/web/tree.ts) walks down from the root and
stops at **the deepest entry that is actually drawn**, which is not the same as the deepest entry
containing the reader:

- a node below the `deep` cut-off is not drawn, so its parent is where the reader is as far as this
  panel goes — unless the reader pressed that node's `+N sections` badge, which puts its children
  back on screen and the mark back down onto one of them;
- a node inside a section the reader closed is not drawn either — closing a section must not move the
  mark somewhere invisible;
- a part's range can cover blocks that none of its sections do, so the walk stops on the parent rather
  than returning nothing in the middle of an article.

That walk mirrors what `Entry` draws, and **that agreement is the whole risk in the function** — which
is why both sides call `showsChildren` rather than each writing the rule out. Get it wrong and nothing errors: the panel scrolls to
an element that is not in the DOM, which moves nothing, or marks a row nobody can see. Another
[silent success](../reusable/silent-success.md), and the reason the rule is written once, in
`tree.ts`, rather than decided independently by the component and the scroller.

The scroller finds its row by a `data-follow` attribute rather than by the `now` class, so restyling
the mark cannot quietly break the scrolling — and the attribute is on the row's **body**, not on its
`<li>`. That one is worth the sentence it costs: an open `<li>` contains its whole descendant `<ol>`,
so measuring it asks whether the row's *children* are in view. A part whose own two lines are sitting
in the middle of the panel would read as out of view because a dozen sections under it run off the
bottom, and the panel would scroll for no reason the reader could see. Caught by GPT Sol's review of
the built code, not by a browser — it needs a part that is current while its sections are open, which
is exactly the case a quick look does not produce.

### Scrolling without taking the scroll off the reader

The precedent in this repo is [`ContextPanel`](../../src/web/ContextPanel.tsx), which centres the
current item on a focus line — and it can, because it is `overflow: hidden` and **nothing but that
file ever touches its `scrollTop`**. The summary panel is not that. It is a list the reader scrolls
themselves, and a panel that springs back to where the code wants it is hostile.

So [`follow.ts`](../../src/web/follow.ts) has two rules, and between them the panel never takes the
scroll off somebody using it:

1. **Move only when the target changes.** Not on every render, not on a timer. The trigger is the
   reader crossing into a different section of the article — a thing they did — so a response to it
   is not a surprise. Browsing the outline while the article stays put moves nothing at all.
2. **Move only if the row is not already comfortably visible.** If they have it on screen, wherever
   they put it is better than wherever we would.

Rule 1 is also why there is **no scroll listener here**, and that is the part worth copying. The
obvious implementation watches the panel's own `scroll` events to tell "the reader moved it" from "I
moved it" — and that check is where the bug lives, because a programmatic scroll fires exactly the
same event, and a smooth one fires dozens of them, arriving *after* the flag meant to cover them has
been cleared. Keying on the target means the question is never asked.

The row lands with a margin — `min(72px, a quarter of the panel)` — rather than nudged to the nearest
edge, because a row sitting exactly on the bottom edge is visible and useless: the next section's
title, which is what a reader moving forwards is about to want, is off the bottom. The margin is the
lookahead. And a row taller than the panel keeps its **top**: of the two ends, the title is the one
worth having.

The first placement is instant, later ones slide, and `prefers-reduced-motion` makes them all instant.
That is a decision the code makes per call, which is why there is deliberately no `scroll-behavior:
smooth` on `.summ-scroll` — a stylesheet rule would animate the instant ones too, with nothing to
switch it off. The first placement also runs in a `useLayoutEffect` rather than a `useEffect`, so the
reader never sees a frame of the outline scrolled to the top before it jumps to where they are.

### Why the slide is ours and not the browser's

`scrollTo({ behavior: "smooth" })` was the first version and it is wrong here, for a reason that only
shows up when two moves overlap: **a native smooth scroll has no handle**. Cross into a new section
while the last move is still running, and if the new row happens to be in view already the correct
thing to do is *stop* — and there is no way to say so. The old animation carries on towards a number
chosen for a row that is no longer current, and drags the new one off the screen. Nothing errors; the
panel just drifts somewhere nobody asked for. Also found in review.

So `follow.ts` animates `scrollTop` over `requestAnimationFrame`, hands back the function that stops
it, and stops whatever was running at the top of every run — before anything is measured. That also
buys the other half: **a wheel or a finger on the panel cancels the move**, which is the same bail-out
[`scroll.ts`](../../src/web/scroll.ts) gives the article.

That cancellation is checked rather than assumed, and checking it needed a trick, because a
backgrounded tab runs no rAF and a suspended animation looks exactly like a cancelled one. The
browser pass on 2026-08-26 replaced `requestAnimationFrame` with a queue it pumped by hand: step the
slide to its halfway timestamp, watch `scrollTop` jump, dispatch a real wheel event, then confirm the
pending frame has left the queue and that pumping again moves nothing — which is what tells
*cancelled* apart from *paused*. Written up in
[browser-testing.md § Driving a rAF animation by hand](browser-testing.md#driving-a-raf-animation-by-hand).

### The flick that moved the article

Found in a browser pass, 2026-08-26, and only because the window was too narrow: wheeling the outline
when it is already at its top scrolls **the article**. Chrome chains an over-scroll to the nearest
scrollable ancestor by default, and here that ancestor is the page — so the chain runs *outward* from
this panel into the piece, moves `?at=`, and moves the panel back. A flick in the outline is not a
request to go somewhere, and it should not be able to become one.

`overscroll-behavior: contain` on `.summ-scroll` stops it. Narrow windows only make it easy to do by
accident; it was always there.

**Testing note, because the obvious check gives a false pass**: a `WheelEvent` dispatched from
JavaScript does not trigger native scroll chaining at all, so a synthetic wheel reports containment
whether or not the rule is present. Only a trusted OS-level wheel exercises it.

### What it costs

Stated rather than smoothed over:

- Opening or closing a section, moving either control, or the summaries arriving reflows the list
  without changing which row is current, so `rung`, `deep`, `closed`, `opened` and the joined tree are passed to
  the hook as re-run triggers. A re-run with the row already in view costs one
  `getBoundingClientRect` and moves nothing. `root` is the one that was missing at first: it changes
  when a rewrite lands, which can turn every one-sentence gist into a paragraph.
- **A window resize or a late font swap is not covered.** Neither changes any of those triggers, so
  the row can drift out of view and stay there until the reader crosses a section boundary. A
  `ResizeObserver` would close it — [`ContextPanel`](../../src/web/ContextPanel.tsx) has one — and is
  deliberately not here, because it would also be a way for the panel to move when the reader has
  scrolled it somewhere on purpose and touched nothing since.
- **One hole that did need a timer**, and it is worth saying why the timer is not the thing this
  design was avoiding. `?at=` is debounced by `POSITION_SETTLE_MS`, so the target changes *late*: a
  reader who stops scrolling the article, moves to the panel and gives it a flick can have the delayed
  update arrive on top of them. So the panel is left alone for `POSITION_SETTLE_MS + 120` after the
  reader scrolls it — **derived from the debounce, not written down as a number**, because that is
  exactly the window it exists to cover. The signal is `wheel` and `touchmove`, which are the reader's
  hand and nothing else; no programmatic scroll has ever fired one. A `scroll` event would have been
  the ambiguous signal, and there is still deliberately no listener for it. `pointerdown` is left out
  too — a click on a summary row is a pointer event on this panel, and counting it would suppress the
  follow that the click's own jump is supposed to cause.

  **Fable, asked the same question independently, wanted four seconds rather than four hundred
  milliseconds**, on the argument that "only when out of view" does not protect a reader who browsed
  away — they are out of view *by definition*. That argument is right about the geometry and wrong
  about the trigger: nothing ticks while the reader is in the panel, because `?at=` only moves when
  they scroll the *article*, and scrolling the article is them going back to reading. A four-second
  hold would buy nothing for the case it names and would make the panel feel dead for four seconds
  after any flick. So the window covers the handoff — the debounce — and nothing more.

## Steering a rewrite, and where that box went

**Added 2026-08-26, deleted 2026-08-30.** There was a box beside the write button. Greg:

> for the "Write them again", add an input-textbox so the user can give guidance to steer the summary
> generation - this should be added to the prompt and tweak the output that gets generated, but make
> sure the LLM doesn't overweight this and give a really distorted summary, i.e. we want to stay
> faithful to the text.
>
> — Greg, 2026-08-26

It asked *"What are you reading this for?"* with the placeholder *"e.g. I care about the evidence,
not the history"*. The reader profile's per-article half asks *"Why you're reading this one"* with
*"e.g. I want the evidence, not the history"*. One question, asked twice, in two places, with a
precedence rule in `SYSTEM` between the two answers. Greg, 2026-08-30:

> the Summary steer should be derived from the user- and text-prompts combined (if they exist), if
> ("Use profile") is checked, otherwise not. No need for a Summary-specific steer.

And that was already the plumbing: the profile reaches this prompt on every run and
`useProfile: false` withholds it. So the box, `Summaries.guidance`, the 600-character cap, the
`sameWork` comparison and the whole wire path are gone.
[steer-becomes-the-profile.md](../plans/steer-becomes-the-profile.md) has the removal.

### What survived it, because the second half of Greg's sentence is the whole design problem

A note like *"I care about the evidence, not the history"* asks the model to choose what to put
first. The failure it invites is the model quietly reporting an article as being *about* evidence
because that is what it was asked about — and a distorted summary is undetectable from the panel,
which is the one failure that would make personalising a summary not worth having.

Almost none of the answer was ever in the UI. It was five rules in the **constant** half of the
prompt. Read against `PROFILE_RULES`, three already had an equivalent there and **two did not**, so
those two stayed — rewritten for the profile, in `SYSTEM` in
[`src/summarise.ts`](../../src/summarise.ts) § IF THE READER HAS DESCRIBED THEMSELVES:

- Never add, sharpen or bend a claim to fit what they are after. If the article does not say it, it
  does not go in. You are not answering them; you are summarising the section.
- Keep the article's own proportions. A description of the reader cannot promote a passing remark
  into the main point of a section.

**They are here rather than in `PROFILE_RULES`, and that was a correction.** The shared string is
appended to *seven* system prompts, and "if the article does not say it, it does not go in" is
exactly backwards for two of them: [ideas.md](ideas.md)'s more valuable half is what the piece
*never states*, and a glossary entry's `background` is explicitly not the article's knowledge. A
profiled ideas run could have obeyed the shared rule by returning none of the half the feature
exists for, and nothing would have looked broken. GPT Sol caught it before it shipped.

They are in `SYSTEM` rather than beside the profile **so the constraint cannot be edited by the
thing it constrains**, and because `SYSTEM` is a constant every batch shares. The profile itself goes
in the user prompt, near the top, with a two-line reminder standing next to it — a constraint three
thousand tokens above the text it constrains is one the model has stopped weighing.

`PROMPT_VERSION` went to `summary/4` with that edit, so a summary written to the old rules reads as
**outdated** — *the article is the same and we would write these differently now* — rather than
silently as current. That matters more than it sounds: it is also what stops a summary written to a
steer that no longer exists going on displaying with nothing to explain why it leans the way it does.

## What this deliberately does not have

**The expertise axis.** Their second version crossed three lengths with three reading levels
(beginner / intermediate / expert) behind two sliders. There is no evidence anywhere in their repo
that anyone used it — no telemetry, no follow-up doc, no critique — and two sliders is a lot of
interface for a thing nobody measured. If reading level ever matters here, the cheaper form is a
single global setting rather than a second axis on every summary, so that the zoom axis keeps meaning
one thing.

**Generation on demand.** Nothing is written when you move the Length control. Pre-generating is what
makes the ladder feel like a control rather than a wait, and it is the requirement their own doc is
clearest about. It also makes their other bug impossible here: their heading tooltips fetched
summaries for headings the granularity filter had already hidden — real money spent generating text
nobody could see.

**Markdown.** The rungs are plain paragraphs by instruction, and blank lines are the only thing
interpreted. Rendering arbitrary model output as HTML is what [security.md](security.md) is about.

## What is still open

- **No evidence it helps.** The same criticism the previous version earned, and repeating their
  mistake would mean never asking. [Q6](open-questions.md) is where "how would we know we are failing
  at this" lives.
- **The whole-article `long` rung is about a page**, which is a lot of prose in an 18rem band on a
  narrow window. Nobody has looked at it below ~900px, which is the same gap
  [chat-mode.md](../plans/chat-mode.md) records for the band generally.
- **No keyboard shortcut** switches into the mode or moves the ladder. The app still has no shortcut
  map at all.
- **The panel follows the reader but never leads them.** There is no "the reader scrolled the panel
  away, offer them a way back" affordance — no *jump to where I am* button, no edge indicator saying
  the marked row is off-screen above. Deliberate for now (one control fewer, and crossing a section
  boundary brings it back on its own), but it is the obvious next thing if anyone reports losing the
  mark.
- **A section whose summary is subtly wrong** is undetectable from here. `missing` catches an absent
  summary; nothing catches a plausible one about the wrong thing, which is the same residual risk the
  citation counting in [chat-mode.md](../plans/chat-mode.md) leaves behind. A reader profile makes
  this risk *larger*, which is why the rules holding it to emphasis are written where they are — and
  there is still nothing that would catch a summary that quietly followed the profile off the text.
- **Nothing checks that a cited id is the right paragraph.** `unknownCited` catches an id that does
  not exist; an id that exists and carries a different claim reads exactly like a good one. The
  hover card is the mitigation, and it works only if somebody hovers.
- **The citation density is a prompt rule with no floor under it, and it currently runs at the top of
  what the rule allows.** Measured on the first real run (Graham, *Writes and Write-Nots*): 65
  citations over nine entries, about one per sentence, two or three per paragraph. A browser check
  called that *"noticeable but not overwhelming — borderline"*, which is the honest reading. Nothing
  enforces it; `cited: 0` in the log is how we would find out it had decayed the other way, which
  means finding out afterwards.
- **A browser check reported the hover card rendering behind the Length/Depth pills. It does not.**
  Recorded because it cost half an hour and would cost it again. The tooltip layer is `z-index: 100`
  (styles.css § `.tooltip-anchor`), above the spine at 45, the band at 44 and the drawer at 95, and
  it portals into `<body>`, so nothing in the band can paint over it. What the screenshot caught was
  the 120ms opacity fade in `useTransitionStyles` — and the giveaway is in the screenshot itself: the
  card's *text* is drawn **over** the pills, uniformly translucent, rather than being occluded by
  them. A stacking failure looks like crisp pills hiding the card; this looked like both at once,
  everywhere. The other candidate — `--surface-raised` failing to resolve in a portalled node, which
  would leave the card genuinely transparent — is impossible: it is defined on `:root` and custom
  properties inherit to every element in the document.
- **The hover card is wider than the band it opens in** — 26rem against a band of 18–25rem
  ([`layout.ts`](../../src/web/layout.ts) § `MODE_MIN`/`MODE_IDEAL`) — so a card anchored near the
  band's left edge draws over the spine rail. It is on top (the tooltip layer is `z-index: 100`) and
  it is transient, so this is untidy rather than broken, and narrowing it would only make it taller.
- **Re-running replaces rather than extends.** There is no "write me more detail on just this
  section" — the whole artefact is rewritten. That is the right default and the wrong thing if the
  ladder ever grows a fourth rung.

## See also

- [original-version/summaries.md](original-version/summaries.md) — **read this first**: their ladder,
  their one-call batching, and the two failures this is shaped around
- [original-version/structure-panel.md](original-version/structure-panel.md) — the depth cut-off and
  the "+N hidden" badge
- [original-version/borrow-list.md](original-version/borrow-list.md) — items 2 and 5, both landed here
- [granularity-zoom.md](granularity-zoom.md) — the tree these summaries hang on, and why detail and
  depth are one axis
- [table-of-contents.md](table-of-contents.md) — the length rules per depth, and why a row's job is to
  distinguish itself from its siblings
- [block-ids.md](block-ids.md) — the contract the range anchoring rests on, and what a shown id is
- [../plans/chat-mode.md](../plans/chat-mode.md) — the citation contract these chips share, and where
  `Cited.tsx` came from
- [architecture.md](architecture.md) — where stage 5e sits, and the storage layout
- [ingest-queue.md](ingest-queue.md) — the job that writes them, and why it is not part of adding an
  article
- [url-state.md](url-state.md) — `?len=` and `?deep=` among the rest
- [glossary.md](glossary.md) — the mode this one is built in the image of, down to the panel's shape
- [../plans/chat-mode.md](../plans/chat-mode.md) — where the mode band came from
- [../plans/bottom-bar.md](../plans/bottom-bar.md) — the bar the Summary button lives in, where it was
  a dimmed placeholder until now
- [column-context.md](column-context.md) — the other panel that holds the current item in view, and
  why it can centre and this one cannot
- [../reusable/silent-success.md](../reusable/silent-success.md) — the pattern `missing` and the
  fallback tag exist to defeat
