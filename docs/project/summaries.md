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
 │           │                          +4 sections  │                         │
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

### Two ways to be hidden, and they are not one variable

The one design note worth copying from their structure panel verbatim:

> *"too deep to show"* and *"I closed this"* are different states and should not share a variable.

So `deep` removes a whole level and `closed` is a set the reader put nodes into, and the two compose.
A node hidden by the cut-off does not quietly un-close itself when the cut-off moves. The `+N
sections` badge is theirs too, capped at `99+` and suppressed at zero exactly as their reviewer asked
for — and it is a **control when the reader closed those sections and a fact when the cut-off hid
them**, because pressing it in the second case would silently overrule the Depth buttons above it.

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
- **A section whose summary is subtly wrong** is undetectable from here. `missing` catches an absent
  summary; nothing catches a plausible one about the wrong thing, which is the same residual risk the
  citation counting in [chat-mode.md](../plans/chat-mode.md) leaves behind.
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
- [block-ids.md](block-ids.md) — the contract the range anchoring rests on
- [architecture.md](architecture.md) — where stage 5e sits, and the storage layout
- [ingest-queue.md](ingest-queue.md) — the job that writes them, and why it is not part of adding an
  article
- [url-state.md](url-state.md) — `?len=` and `?deep=` among the rest
- [glossary.md](glossary.md) — the mode this one is built in the image of, down to the panel's shape
- [../plans/chat-mode.md](../plans/chat-mode.md) — where the mode band came from
- [../plans/bottom-bar.md](../plans/bottom-bar.md) — the bar the Summary button lives in, where it was
  a dimmed placeholder until now
- [../reusable/silent-success.md](../reusable/silent-success.md) — the pattern `missing` and the
  fallback tag exist to defeat
