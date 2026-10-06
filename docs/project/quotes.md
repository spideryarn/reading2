# Quotes — the lines worth keeping

The sentences of a piece that are worth carrying out of it, in the band between the spine and the
prose. **Every row is the article's own text**, verified verbatim against the block it came from, and
**every row the panel is showing is marked in the prose — in every mode, whether or not the band is
open** — pressing one rings it and takes you there. (The one exception is a row whose block a
re-extraction took away.) See
[§ Every visible quote is marked](#every-visible-quote-is-marked-in-every-mode-and-the-bar-is-how-many).

*The article's*, and deliberately not *the author's* — see [§ Whose words these are](#whose-words-these-are).
Verification can prove the words are in the piece. It cannot prove who wrote them, and the promise
this mode makes is the one it can keep.

**Every reader sees it.** It was behind the
[experimental-features switch](experimental-features.md) from 2026-09-03 until 2026-09-06, when Greg
took it out — *"Quotes mode is valuable enough that we should promote it to always show it"*. The
limit above is unchanged; it is now something a reader meets rather than a reason to hide the mode.

Built 2026-08-31. Greg asked for it that day:

> Create a "Quotes" mode that extracts the most central, helpful, interesting quotes. By default,
> display them in order. But also have a sub-mode for ordering them by importance, and a sub-mode for
> ordering by how memorable/interesting/striking/lyrical/etc. And add a threshold UI bar, and a
> Prioritised mode. Take inspiration from the Glossary mode.

The design, the alternatives, and the cross-family review that rewrote two of its foundations before
a line was written are in [260831j-quotes-mode.md](../plans/260831j-quotes-mode.md). **Read that before changing
anything here** — the two exclusions in `authorVoice` and the "store the slice, not the model's
string" rule look like fussiness until you know what they are answers to.

**What is not built** — a copy button, keyboard traversal of the list, measurements several
defaults rest on — is listed at the end, in [§ What is still open](#what-is-still-open).

```
  QUOTES MODE — same spine, same article, the band is the piece's own sentences

 ┌─────────────┬───────────────────────┬────────────────────────────┬───┐
 │             │  Mode: quotes                                       │   │
 │  ▇▇▇▇▇▇▇▇   ├───────────────────────┼────────────────────────────┤ ▍ │
 │  ▇▇▇▇▇      │ ❝ Quotes      14      │  … and the most mundane    │   │
 │  ▇▇▇        │ order  in order       │    boilerplate — the sort  │   │
 │  ▇▇▇▇▇▇▇    │  [prioritised]        │    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓    │   │
 │  ▇▇         │  most important       │  ┃ of thing you'd have to  │ ▍ │
 │  ▇▇▇▇       │  most striking        │    be able to write …      │   │
 │  ▇▇▇        ├───────────────────────┤                            │   │
 │  ▇▇▇▇▇      │ bar 0·60 · 12 of 14   │      ↑ the wash and the    │   │
 │  ▇▇         │ ────────●──────────   │        ┃ border — the SAME │ ▍ │
 │  ▇▇▇▇▇▇     │ 2 quotes are hidden   │        marks a search hit  │   │
 │             │ by this threshold.    │        draws, because it   │   │
 │             │ Drag the slider left  │        IS one              │   │
 │             │ to show them.         │                            │   │
 │             ├───────────────────────┤                            │   │
 │             │ ✧ 2 suggestions were  │                            │   │
 │             │   dropped because the │                            │   │
 │             │   words are not in    │                            │   │
 │             │   the article.        │                            │ ▍ │
 │             ├───────────────────────┤                            │   │
 │             │ ┃Writing is thinking; │                            │   │
 │             │ ┃there is no other    │  ⓘ  k3m9qt                 │   │
 │             │ ┃kind.                │  ↑                         │   │
 │             │ │ imp·91  str·88      │  └─ press it and the       │   │
 │             │ │                     │     model says WHY this    │   │
 │             │ ┃A model that cannot  │     one. Hover, focus or   │   │
 │             │ ┃be surprised has     │     tap — a tap pins it.   │   │
 │             │ ┃stopped reading.     │  ⓘ  qw82nf                 │   │
 │             │ │ imp·62  str·94      │                            │   │
 │             │ ┃…                    │                            │   │
 ├─────────────┴───────────────────────┴────────────────────────────┴───┤
 │ ⊞Hierarchy ▤Summary 📖Glossary 💡Ideas ❝Quotes ● 🔍Search ⌸Chat  …     │
 └───────────────────────────────────────────────────────────────────────┘

 EVERY WORD IN THE LIST IS FROM THE ARTICLE. The only things on screen that
 are not are the two numbers, which are labelled as the model's judgment,
 and the reason, which is behind the ⓘ.

 The solid left rule is the glossary's "in this piece" rule, reused rather
 than re-declared: it means the same thing here — this came from the
 article — and a second panel drawing that distinction differently would
 teach the reader it means something else.

 The ✧ line is what the stage REFUSED to store. It is there
 because a list quietly shorter than the model produced is the failure
 docs/reusable/silent-success.md keeps catching, and a log line is
 invisible to the reader it happened to.
```

Code: [`src/quotes.ts`](../../src/quotes.ts) (stage 5h — the prompt, the call, the verification),
[`src/quote-match.ts`](../../src/quote-match.ts) (the matching rule, shared with search and ideas),
[`src/store/pg.ts`](../../src/store/pg.ts) § `loadQuotes`, [`src/routes.ts`](../../src/routes.ts),
[`src/web/QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx),
[`src/web/useQuotes.ts`](../../src/web/useQuotes.ts), `resolveQuotes` in
[`src/web/search-hits.ts`](../../src/web/search-hits.ts),
[`src/web/modes/quotes/QuotesMode.tsx`](../../src/web/modes/quotes/QuotesMode.tsx)
(`QuotesBand`, `VisitorQuotesBand`, `useQuotesMode`), and `§ quotes mode` in
[`src/web/styles/quotes.css`](../../src/web/styles/quotes.css). Tests:
[`tests/quotes.test.ts`](../../tests/quotes.test.ts) (the stage),
[`tests/quotes-panel.test.ts`](../../tests/quotes-panel.test.ts) (the orders and the bar),
[`tests/quote-marks.test.ts`](../../tests/quote-marks.test.ts) (what the prose marks),
[`tests/quote-fill.test.ts`](../../tests/quote-fill.test.ts) (the fill, its fade and its colours),
[`tests/quotes-find-more.test.ts`](../../tests/quotes-find-more.test.ts),
[`tests/quotes-find-more-stage.test.ts`](../../tests/quotes-find-more-stage.test.ts) and
[`tests/quotes-find-more-panel.test.tsx`](../../tests/quotes-find-more-panel.test.tsx) (Find more:
the merge, the stage with its model stubbed, and the panel).

## The one safety property

**A line the model offers that cannot be found in the article is dropped, never shown.**

Every other stage here can be wrong about a judgment. This one can be wrong about *what the author
wrote*, which is a different and worse kind of wrong: a plausible paraphrase, in quotation marks,
attributed to a real person, sitting next to the real text. Everything below is downstream of that.

### The model returns words, never a block id

The glossary's rule rather than the ideas' rule, and the choice is deliberate. An idea is a
proposition with no text of its own, so the only route back to the page is an id the model names
([ideas.md](ideas.md#this-is-the-first-stage-that-lets-the-model-name-block-ids)). A quote *is* text.

```
   the model returns  →  the exact words, and nothing else
   we find            →  which block they are in — `locate`, over every body block
```

So the model cannot invent a location, a quote it would have misattributed is repaired rather than
dropped, and the prompt can send `articleText` rather than `articleWithIds`.

### What is stored is the article's characters, not the model's

`findQuote` is an **equivalence relation, not an identity test**: it folds curly quotes to straight
ones and collapses runs of whitespace, so a match says *these are the same passage* and never *these
are the same characters*. The first version of this stage stored the model's typing, which put words
in the author's mouth on every fold.

`place` slices the block instead — `block.text.slice(span.start, span.end)` — so the model's text is
a **locator and nothing else**. Whatever it typed, what is stored, shown and attributed is what the
article says.

**And the verification runs only `findQuote`'s first pass** (`passes: "spaced"`). The second pass
deletes whitespace, which is right for the browser — `extractText` invents spaces at nested block
boundaries that the rendered text does not have — and wrong as a claim that the model copied
something: it accepts `fall a part` against an article saying `fall apart`. Verified against
`data/noema-mythology-of-conscious-ai`. GPT Sol found both halves of this, 2026-08-31.

### Whose words these are

**`findQuote` proves the words are in the article. It proves nothing about who wrote them**, and an
article is full of other people's sentences. `data/meditations-on-moloch` carries twenty
`kind: "quote"` blocks and the first is Ginsberg's *Howl* — exactly the striking passage this stage
reaches for, verifying perfectly, and offering it under the essayist's name would be this feature's
worst failure wearing its verification badge.

`authorVoice` refuses two things, deterministically:

| refused | why |
|---|---|
| a `kind: "quote"` block | whoever wrote it, the piece has typographically disowned it |
| a span **wholly** wrapped in quotation marks | the inline case, in an ordinary paragraph |

`wholly` is the care in the second one: a line that merely *contains* a quoted phrase is still the
article's own sentence and is kept. The first one costs something real — an author quoting their own
earlier work, which the Moloch essay also does — and that is an accepted loss, because a reader
looking at the list cannot tell the two apart and neither can we.

**The second check is deliberately independent of where the model drew the span**, and it took a
second review to get there. The first version compared the single characters either side of the span,
which trusts the model to have drawn it where a person would; it was walked round three ways:

| what the model did | why the old check passed it |
|---|---|
| returned the quotation marks **inside** the quote | the character before was the colon, and there was none after |
| left the **full stop** behind | the character after was `.`, not `”` |
| the piece used **British single marks** `‘…’` | curly singles were excluded along with the apostrophe |

All three are answered by peeling the span's own edges first — a mark the model included is the
strongest evidence there is, because it is the one thing the model definitely saw — then stepping
over sentence punctuation before looking outward, and by including the curly singles. The straight
`'` stays out, and that is the one trade left: `'…'` around a sentence is ambiguous with an
apostrophe, and dropping the article's own emphasised line is worse than keeping a quoted one.

**And `locate` walks past a rejected occurrence** rather than stopping at the first match. A sentence
can appear once inside a pull-quote and again in the prose; taking the first occurrence lost the
reader a legitimate line and blamed the model for it in the counter.

**What it does not catch:** an inline quotation with no marks, an indirect one, a translated one.
Block text carries no provenance, so nothing at this layer can. Hence the promise the mode actually
makes is the one the machine can keep — **these are verbatim passages from this article** — rather
than a claim about authorship. Recording provenance during extraction is the real fix and is not
built.

### The drops are counted, and the reader is told

```ts
{ unfound, otherVoice, wrongLength, overlapping, overCap, malformed }
```

`unfound` is the one to watch: it counts the model paraphrasing rather than copying, and a run that
starts returning several is a prompt that has drifted. Nothing else would report it — a dropped
quote looks exactly like a line the model chose not to offer
([silent-success.md](../reusable/silent-success.md)).

They ride on the **artefact** (`Quotes.discarded`), not only in the log, and the panel says the two
the reader has a stake in: *"2 suggestions were dropped because the words are not in the article."*
A count in a log is invisible to the person the drop happened to. The other four are internal
rejection details the reader has no stake in, and naming them would turn a disclosure into a
changelog.

**`discarded` crosses to a visitor too**, which is the one pipeline-shaped field
[public-types.ts](../../src/public-types.ts) lets through. It is not a fact about our pipeline — it is
a fact about *the list on the screen*, that it is shorter than what was produced — and a visitor
reading that list has the same interest in knowing as its owner. Stripping it would have made "the
reader is told" true for half the readers and quietly false for the other half.

**The sentence says "appearing as a quotation", never "quoted from somebody else."** The second is a
claim about authorship and we cannot make it: an author quoting their own earlier work lands in that
counter, and the whole reason `authorVoice` refuses a blockquote is that we cannot tell those apart.

### The scores are counted too, and nobody is told

```ts
{ importanceAbsent, importanceRejected, strikingAbsent, strikingRejected }
```

A **second** shape — `QuoteScoreDrops` in [quotes.ts](../../src/quotes.ts) — and not four more
counters on `discarded`, because none of these costs the reader a quote: the line is in the list, one
number short. It does not ride the artefact and it is not shown to anybody. A reader cannot act on a
score the model failed to write, and it is a fact about our prompt rather than about their article.

**Absent and rejected are apart.** Absent is a field the model never wrote — permitted here, and
`priorityOf`'s `max` was designed around it. Rejected is one it wrote wrong, which `score()` throws
away silently: a model that started answering `"high"` for `0.8` would quietly stop the panel
offering *prioritised* order and nothing anywhere would say so
([silent-success.md](../reusable/silent-success.md)). A counter that only fired inside `score()`
would see the second and never the first. Counted per field, in `place`, over the quotes it kept —
so `dedupeOverlaps` and `MAX_QUOTES` do not move them; the question is what the *model* returned.
Logged at the end of the stage in [pipeline.ts](../../src/pipeline.ts). The glossary's twin is
[glossary.md § The scores the prompt required, and did not get](glossary.md#the-scores-the-prompt-required-and-did-not-get).

## Two scores, combined with `max`

| field | the question |
|---|---|
| `importance` | how much of the article's argument rests on this line |
| `striking` | how memorable, quotable, well-put it is |

The glossary **multiplies** its two, and that is right *there*: `difficulty × centrality` is the cost
of not knowing a term, and a term that is easy, or peripheral, has no such cost. Two factors of one
quantity.

**These two are not factors of one quantity. They are two separate reasons to keep a line.** Greg
chose `max` on 2026-08-31:

> what this gets right: a line can earn its place for ONE good reason. The sentence the whole essay
> turns on is promoted even if it is drily written; the line you would tattoo on your arm is promoted
> even if the argument would survive without it.

Three consequences, and the third is a correction:

- **A missing score is skipped, not read as zero** — and under `max` that is safe in a way it is not
  under a product. A maximum over a subset can only be *lower* than the maximum over both, so a
  quote scored on one axis can be under-promoted and never over-promoted, which is the direction an
  honest default has to fail in.
- **The bar starts at `0.60`, well above the glossary's `0.10`**, because a product of two 0–1
  scores clusters low and a maximum clusters high. It started at `0.70`, the first real run moved it
  to `0.80` — see below — and on 2026-09-15 it came down to `0.60` at Greg's request that every
  prioritised bar let most entries in by default: 85% on average across the local quote lists, 95%
  on the median one, with the snap to real scores modelled
  ([260915d](../plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md)).
- **The right-hand end keeps "all the top-scored quotes", not "exactly one".** The plan claimed
  the glossary's promise and it does not carry: under `max` either score can produce a top value, so
  ties at the top are common. GPT Sol showed it false with a five-quote example.

Both raw numbers are on a prioritised row and the composite never is — that is our arithmetic dressed
as the model's judgment, and a number the reader can neither interpret nor check. `document` order
shows no numbers at all, which is the glossary's rule and the whole condition on keeping model scores
([glossary.md § The scores](glossary.md#the-scores-and-the-condition-attached-to-keeping-them)).

## The orders, and the bar

| `?rank=` | label | what it does |
|---|---|---|
| `document` | **in order** | first appearance — **the default** |
| `prioritised` | **prioritised** | first appearance, with everything below the bar hidden and counted |
| `importance` | **most important** | descending; unscored last |
| `striking` | **most striking** | descending; unscored last |

**`document` is the default and that is Greg's own instruction**, not an inherited convention — *"By
default, display them in order."* The glossary defaults to `prioritised`; copying that here was the
first version, and a cross-family review pointed out that the glossary's later override is not
permission to override an explicit decision about a different feature.

**There is no head row while the order row is drawn**, since 2026-10-01 — Greg, on a landscape
iPhone (`spya-gcdwps`). The count and the profile badge (an icon, as Glossary's is) sit at the order
row's right-hand end, the count only outside *prioritised*, whose bar row already says "5 of 14";
the "order" word in front of the buttons went too. The Glossary move
([260929a](../plans/260929a-compact-glossary-header-and-kind-icons.md)), made here in
[261001l](../plans/261001l-compact-quotes-and-citations-band-tops-and-click-a-diagram-to-enlarge.md).

### Every visible quote is marked, in every mode, and the bar is how many

**In every mode since 2026-09-08**, which is [260908i](../plans/260908i-quotes-marked-in-the-prose-in-every-mode.md).
Greg, in the feedback report that asked for it (SPIDERYARN-READING2-2P):

> Always show the quotes (highlighted with a border around them), if there are any that have been
> generated. Always show them in the text view, even if we're not in quotes mode.

The marks were published by the band, so they lived exactly as long as it did and went the moment
the reader pressed Plain. **They are no longer published at all**: everything they are made of — the
artefact, `?quote=`, `?rank=`, `?bar=`, the blocks — is state `Reader` already holds, so
[`useQuoteMarks`](../../src/web/reader/useQuoteMarks.ts) computes them and the whole publication
protocol went with them, including the `derived` arm of `usePassageLifecycle`, whose only caller
this was.

Three consequences worth knowing before changing anything here:

- **The quotes reach the prose in every mode and the paragraph bar and the ring outside Quotes in
  none.** `proseFound` in [reader/passages.ts](../../src/web/reader/passages.ts) is the whole of that
  split and carries the argument: a quote's `confidence` is `null`, which `blockStrength` reads as
  certainty, and every quote's `slot` is `0`, which is the first saved search's colour. In quotes
  mode the picked slot *is* the quotes, so nothing there changed. **The spine rail is the
  exception since 2026-10-02**: the quotes have a strip of their own there, in every mode — §
  [In the spine, on a card, and one at a time](#in-the-spine-on-a-card-and-one-at-a-time).
- **The opening read moved up**, `useQuotesRead` in `OwnedReader`, exactly as the glossary's did in
  2026-08-27 and for the same reason. `useStepJob` and `useAutoRun` stayed in the band deliberately —
  a job subscriber up there holds the engine to its idle cadence for every reader of every article,
  and an activation owner up there could spend a Quotes press after the reader had left the band.
- **A quote is the one mark a tap may fall through.** `NOT_A_BLOCK_SELECTION` in
  [TableView.tsx](../../src/web/TableView.tsx) excludes every `<mark>` because a tap on one already
  means something — except a quote, which nothing acts on. With dozens of them on the page in
  Plain, a blanket exclusion would make the best sentences in the piece the ones a finger cannot
  select, and therefore cannot annotate ([touch.md](touch.md)).

**What is still open** is the density: the default `?rank=` is `document`, where `rankQuotes` returns
the whole list and the bar does nothing, so a reader who has never touched the controls meets all of
them. The bar is the control and it survives a mode change, but it is only reachable from inside
quotes mode. Nobody has yet looked at a full list of them at once — 40 from one pass, up to 120 after Find more (§ Find more appends).

Since 2026-09-05 the whole shown list is marked rather than only the *selected* one — until then the
mode drew nothing at all on the
article until you pressed a row, and the slider changed the list without changing the page. Greg,
in the feedback report that asked for it (SPIDERYARN-READING2-1Z):

> skim through it just reading the stuff that is marked

**Outside Skim, what is marked is what the panel lists**, and that is one function — `markedQuotes` in
[`QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx), called by the panel and, since 2026-09-08, by
[`useQuoteMarks`](../../src/web/reader/useQuoteMarks.ts) rather than by the band — so the rows and
the marks cannot come apart, and the bar doubles as the highlight-density control. A row the bar
has hidden with its mark still on the paragraph is the precise failure
[threshold.ts](../../src/web/threshold.ts) exists to prevent.

**Skim deliberately adds its current stop after that rule.** Its stop remains marked while the
reader is standing on it even when Quotes' bar hides it; `proseFound` owns that exception. The spine
strip and the quote card therefore read the merged prose marks, not only `markedQuotes`.

**One row can legitimately have no mark**, and only one: a quote naming a block the article no
longer has. `resolveQuotes` drops it; the row stays in the list, unmarked, above a `stale` banner
already saying the article moved. Hiding it instead would make the list quietly shorter than the
artefact, which is the other failure ([silent-success.md](../reusable/silent-success.md)).

Two things had to move with it, and both are about there now being sixteen marks where there was one:

- **The quotes are one source.** `resolveQuotes` gives every quote the same `runId` (`QUOTES_RUN`)
  and slot `0`, so the rail draws **one lane** and a paragraph gets one segment. The rail packs one
  lane per run id in a ten-pixel gutter ([spine-marks.ts](../../src/web/spine-marks.ts)), so a run id
  per quote would have been a sixteen-lane smear of 1.5px marks ordered sideways by an arbitrary
  string. The individual quote's identity stays in `Found.key` — `quoteMarkKey`, one place.
  (**No quote takes a lane at all since 2026-10-02** — they have their own strip, below — but one
  run id is still what keeps Skim's stop and the panel's mark one passage.)
- **The pressed quote gets the ring**, `mark.hit[data-hit-open]`, which search has always had and
  quotes did not need while there was one mark on the page. It came up in the same layout effect as
  the marks so that no paint could show the ring on one quote and the mark set of another; since
  2026-09-08 `useQuoteMarks` returns both out of **one render**, which has that property by
  construction and left the `derived` lifecycle shape with no caller.

### In the spine, on a card, and one at a time

Since 2026-10-02, [261002h](../plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md).
Greg, in two feedback reports:

> Perhaps show Quotes in the spine (use the same colour we use for their outline-border)
>
> — 2026-09-10 (spya-yd2c47)

> For the highlighted-Quotes shown in the text (with an outline-border), tooltip to show our
> quantitative scores and perhaps Previous/Next icon-buttons to jump to the next Quote, and a button
> to open Quotes mode.
>
> And in Quotes mode, add fairly big Previous/Next icon-buttons to jump around, and use left/right to
> navigate between quotes.
>
> — 2026-09-11 (spya-mtyquy)

- **The spine: a purple strip down its left 2px, in every mode** — `--quote-rgb` (a green until
  2026-10-03, when the quote colour moved), faded by the block's brightest quote exactly as the fill
  is. **Its own element, never a lane**
  (spine-marks.ts § `quoteRailMarks`, the `.spine-from` precedent): the search gutter is the right
  10px of the 12px rail, so the strip pushes no search sideways and is never counted as a "search
  match" on a band's card. It is drawn from what the prose actually marks (`proseMarked`), which
  includes Skim's stop when the bar hides it from the band. And **the quotes left the search lanes
  in every mode** (`railFound` in passages.ts): until then Quotes mode drew them as a lane in
  `--cat-0`, the first saved search's colour, and Skim drew its stop the same way. Where seven or
  more searches are on, the lanes' 1.5px floor reaches into the strip's 2px and paints over it —
  accepted, since the strip is still there above and below. Reading-time runs sit under it.
- **A card on a quote in the prose**, in `ProseHoverCard` beside the term, citation and link halves:
  both raw scores, drawn and printed (this card is where the rows' numbers live — never the `max`
  composite); the reason, in the model's face; ‹ › to the quote before or after it **down the
  page**; and *open Quotes*, which selects it and opens the band on its row. **Pointer only.** A
  tap on a bare quote still selects its paragraph (TableView's `NOT_A_BLOCK_SELECTION`, the reason
  above), and a quote is not a tab stop — a quote that is also a term, a citation or inside a link
  gets the card through those, as before. **It waits 900ms rather than 320ms** before opening on a
  quote and nothing else (`QUOTE_OPEN_MS`), because a quote is a passage the reader rests in while
  reading, not a word they point at; still a guess to be felt in use.
- **In Quotes mode, ‹ › under the list and ← / →** step the band's own list, in its order, through
  one rule (`stepQuote`) — [keyboard.md](keyboard.md) § ← / → in Quotes. Both step only
  over quotes the prose fills (`useQuoteMarks`' `steppable`), so a row whose block is gone is
  skipped rather than selected with nowhere to go. The selected row scrolls into view in the list
  (its own `scrollTop`, never `scrollIntoView`).

**Deferred, by name:** a tap opening the card (it would cost the paragraph tap above); stepping
from where the reader is when nothing is selected (it goes to the first quote); and keeping the card
open on the next quote after ‹ › (it closes, and the reader points at the next one).

### A highlighter pen, which is how a quote says how much it matters

**A quote is a fill, like a highlighter pen, and a search hit is an outline.** Greg, 2026-10-03
(`spya-xrgste`):

> I think right now the quotes show an outline, and the search results show a highlighter filled in,
> like as if with a highlighter pen. Let's switch this round. I think the quotes should be like with
> a highlighter pen, so filled in, and the searches should have an outline.

The plan is
[261003l](../plans/261003l-quotes-filled-like-a-highlighter-pen-and-search-hits-outlined.md); the
rules are `annotations.css` § quote fills, and the search half is
[search.md § An outline, since 2026-10-03](search.md#an-outline-since-2026-10-03).

| Channel | Carries |
|---|---|
| **the fill** | **that this is a quote, and how much it matters** |
| the outline's top edge and ends | a search's **confidence** (`--hit-a`) |
| the band under the words | **which search** found it |
| the `::after` glyph | a referee criterion's **direction** |
| a fill in yellow, green, blue or pink | the **reader's own** highlight ([comments.md](comments.md)) |

**Two tiers, from `priorityOf`.** `quoteTier` (QuotesPanel.tsx, beside `priorityOf`) is heavy at or
above `QUOTE_HEAVY_AT`, `0.80`, and light below it. **That number is its own, not the bar's**, since
2026-09-15. It used to be the bar's resting position, so every quote the default bar kept was heavy;
when the bar came down to `0.60` the tie would have made the split idle in exactly the state most
readers see. Decoupled, the quotes between `0.60` and `0.80` draw light beside the heavy ones on
first open.

What the two controls still agree on is **order**: raising the bar removes scored light quotes
before scored heavy ones, because both read `priorityOf`. (Not "what survives is exactly the heavy
ones": the bar snaps to real scores, so there may be no stop at `0.80`, and an unscored quote
survives every bar while drawing light.) Driving the tier from `importance` alone would let them
disagree, since `?bar=` thresholds on `max(importance, striking)`; a quote that is merely *striking*
clears the bar, so it must also draw heavy.

**A quote with no score at all is light, and still drawn.** It has earned no emphasis, but a quote
scored on neither axis survives every position of the bar (§ The bar hides what is below it), so
leaving it unmarked would be a row in the panel with nothing in the prose.

**And a fade — the fine channel on top of the coarse one.** Greg, 2026-09-11, in
SPIDERYARN-READING2-2W, when the mark was a border:

> perhaps slightly fade the border based on the priority-score (but even low-priority quotes should
> still be clearly visible)

`quoteAlpha` (beside `quoteTier`) runs from **0.70** at `priorityOf` 0.5 and below — and for the
unscored — to **1.00** at 1.0, linearly, and travels as `--quote-a` in the inline style
`annotateHtml` already writes for `--hit-a`. **The fill's strength is the tier's base times that.**
The bases are per appearance (`--quote-fill-light` and `--quote-fill-heavy`, beside `--quote-rgb` in
`styles/tokens.css`): 0.20 and 0.32 on the light page, so light runs 0.14 to 0.18 (a light quote's
priority stops below 0.80) and heavy 0.28 to 0.32; 0.48 and 0.58 on the dark page, so 0.34 to 0.42
and 0.51 to 0.58, of a darker colour than the light page's
(§ [A little less saturated](#a-little-less-saturated-since-2026-10-06)). Tier
and fade **move the same way**, so a heavier quote is always also a brighter one and the two can never
cancel. It spends the finding of 260907c's acceptance pass, that priority *"does help skimming — but
through brightness more than thickness"*: with a fill, brightness is all there is.

**Two tiers and not three, and that is a measurement rather than a preference.** Blind pairwise on
the box, 2026-09-07, on stroke widths: three tiers scored **13/20, which is chance**; two scored
**12/12**. It has not been re-run on fills. The step between the tiers is asserted in the test
below; whether a reader sees it is the browser check's.

**The words keep their colour, and these are tested, not felt.**
[tests/quote-fill.test.ts](../../tests/quote-fill.test.ts) reads the real tokens in both themes and
requires: the article's ink and its soft ink clear 4.5:1 on the strongest fill there can be; a link
inside a quote clears 3:1 on it (**the weakest pairing, and what set the strengths**: a link is only
5.7:1 on the bare light page, and at the first build's 0.42 it was 2.9:1); the faintest fill still
differs from the page; the heavy tier is stronger than the light where they meet; and the spine
strip, a thin line in `--quote-rgb` at `QUOTE_ALPHA_FLOOR`, clears 3:1.

#### Stronger on the dark page, since 2026-10-05

**This was the first of two changes that day, and the second replaced its numbers** — the colour
and both strengths are in the next section. What is still true from this one is that the strengths
are per appearance, and why the old contrast check missed the complaint.

Greg, two days after the fill shipped (`spya-s0gppw`):

> The quote highlighting color is not very visible against the black background in dark mode. Take a
> screenshot and see if you can slightly tweak it.

The dark page's quote colour was a pale lavender, `204 151 243`, drawn at the light page's two
strengths. At 14% over near-black that is a dark grey with a little purple in it. **The dark
page's strengths went to 0.28 and 0.36**, up from 0.20 and 0.32, so a light quote was about 40%
stronger and a heavy one about 12%
([261005f](../plans/261005f-dark-quote-fill-stronger.md)). The light page's are what they were, and
the test pins them.

**What stopped the lavender going further.** A search hit over a quote draws its outline on the
fill, and the blue automatic search colour (`--cat-4`) was 3.03:1 on the strongest fill; at 0.38 it
was under 3.

**The colour did not move in that change**, though a more saturated purple looked better in the
prose. The spine strip shared it and is drawn on the rail's panel, a lighter ground than the page,
where a darker purple fell from 3.3:1 to 2.2:1 (GPT Sol's plan review). So the question went to
Greg.

**The old contrast check did not catch the complaint**: the faintest fill passed its
"differs from the page" floor at 1.22. That ratio measures luminance only, while OKLab distance also
counts chroma. So on the dark page the test asks for both.

#### A deeper purple in the dark prose, since 2026-10-05

**The numbers in this section are that day's. The colour was turned down the next morning**, and
the current values are in § A little less saturated, below.

Greg, the same day, having looked at the stronger lavender on an iPad:

> the purple Quote-highlights in dark mode on an iPad screen were a little hard to see. I don't mind
> if they're slightly different from the Spine

**So on the dark page the fill in the prose and the strip on the spine are two colours of one
hue.** That releases, for the dark prose fill only, his rule of 2026-09-10 (*"use the same colour we
use for their outline-border"*, § In the spine, above). The fill is `--quote-prose-rgb`,
`151 48 208`: the strip's hue (310), darker with about 1.7 times its OKLab chroma. The strip keeps
`--quote-rgb`, `204 151 243`. On the light page the two tokens hold one colour and nothing moved.
Plan: [261005j](../plans/261005j-dark-quote-prose-colour-deeper-purple-spine-keeps-its-own.md).

**A darker colour is the more visible one here**, because it can be drawn more strongly. The
lavender is light, so little of it can go over the page before the words on it lose contrast, and a
little of a pale colour over near-black is a dark grey. The deeper purple is drawn at **0.48 and
0.60** and what reaches the page is purple: the faintest quote's chroma went from 0.035 to 0.099,
and its OKLab distance from the page from 0.146 to 0.171 (the test's floors are 0.08 and 0.16).

**The words on it are as readable as they were, or more so.** Ink 8.90 to 9.56, soft ink 4.85 to
5.21, a link 4.2 to 4.6, the opaque blue search band or full-confidence outline 3.03 to 3.25. The soft ink in a block drawn on
`--muted` (a code block), which the lavender left at 3.88, is 4.61 and now has a floor in the test.
The step between the tiers grows slightly in OKLab distance (0.047 to 0.048), while its
luminance contrast falls from 1.188 to 1.158 and remains above the test's 1.12 floor.

**Why the strip did not follow.** In the prose colour a 2px strip would be about 2.2:1 on the page
and less on the rail's panel. The test holds that as a control.

**What it did not fix**: a glossary's dotted rule and a cross-reference's rule under a heavy quote
are 2.58 and 2.56, under 3:1. The glossary improves from 2.51; the cross-reference falls very
slightly, from 2.5635 to 2.5562. The test holds minimum floors of 2.50 and 2.55, respectively. Lifting them is a change to those rules (queue entry `qi-9wyymfdy`). Caption ink in a
block on `--muted` under a heavy quote is 2.64, up from 2.22, and has no floor.

**Some overlapping signals lose contrast.** Low-confidence search outlines are translucent; the
opaque-band check above does not cover them. On the strongest fill, a bluish-green outline at
`--hit-a: 0.45` falls from 2.550 to 2.504. The page-coloured gap between abutting quotes falls
from 2.040 to 1.898 against the strongest fill. The reader's four washes become more distinct in
OKLab beside a quote, but lose luminance contrast with it. These are small, on signals already
under 3:1, and accepted as the price of the more visible quote; adjusting the
outline is the next step if a search hit over a heavy quote proves hard to see. The sums are in
[261005j § Independent review](../plans/261005j-dark-quote-prose-colour-deeper-purple-spine-keeps-its-own.md#independent-review-overlaps-and-grounds).

**Change `--quote-prose-rgb` and the two strengths have to be summed again**: they are a set.

#### A little less saturated, since 2026-10-06

Greg, the next morning (`spya-hsbz0z`):

> Now the purple Quote highlighting is a little toooo saturated. Just dial it down a bit.

**So the dark fill is `143 70 189` at 0.48 and 0.58**: the same hue and lightness as the purple of
the day before, with four fifths of its chroma, and the heavy tier a touch weaker. On the page it is
about a quarter less saturated at both ends (the faintest quote's chroma 0.099 to 0.076, the
strongest's 0.156 to 0.119). The light page and the spine strip did not move. Plan:
[261006e](../plans/261006e-dark-quote-fill-a-little-less-saturated.md), which has the table.

**It is a band now, with a complaint at each end.** The lavender was too grey (0.035) and the first
purple too much (0.099), and the test holds the faintest quote's chroma between 0.065 and 0.09.
**Keeping it visible after his "hard to see" complaint bounds the cut**: the faintest quote is
0.162 from the page against an adopted floor of 0.16, so a bigger cut spends more of the remaining
visibility margin.

**The heavy strength moved for the soft ink in a code block.** A less saturated purple of the same
lightness is a little brighter, and at 0.60 the soft ink on `--muted` fell to 4.42; at 0.58 it is
4.52. Ink, soft ink, a link and the blue search colour on the strongest fill are within 0.05 of
what they were on the page. Other grounds and adjacent signals have regressions recorded in
[261006e](../plans/261006e-dark-quote-fill-a-little-less-saturated.md#independent-review).
The step between the tiers is 1.13, down from 1.16, floor 1.12.

**Purple, because the reader has fills of their own.** Since 2026-10-03 a reader's highlight is a
wash in yellow, green, blue or pink. The quote colour was a green at hue about 163, which as a wash
is the reader's green. It is now a purple at hue 310 (`--quote-rgb`, `styles/tokens.css`), 40° from
the reader's blue and 40° from their pink, and the same test fails if either set of tokens moves
closer. Teal, in the wider gap, was the plan's first choice and was refused because the spine strip
shares the token and the spine's reading-time area is a cyan. **Where a reader's highlight covers a
quote's words, theirs wins on those words.**

**How it is drawn.** `background-color` on every fragment. `annotateHtml` emits one `<mark>` per
text node and splits again at every annotation boundary, so one quote containing an `<em>` is
*three sibling elements*; the pieces are square so the fill does not notch at the joins, and only
the two carrying `data-quote-start` / `data-quote-end` are rounded. A 1px line of the page's colour
inside each quote's start keeps two abutting quotes two.

**Pressed, or Skim's current stop: the fill stays and a ring appears**, 1px in the page's strongest
ink, capped at the true ends. Not a stronger fill, because strength already means priority.

**Bold is still out**, though Greg asked for *"perhaps with bold"* on 2026-09-06. It does not change
the paragraph's height — measured — but it **re-wraps** the prose, moving the text after the mark by
80px in the sample. `text-shadow` and `-webkit-text-stroke` thicken without reflowing and are
rejected too, for the older rule: the verbatim column is not restyled to advertise our annotation.

**A quote over a search hit draws both**, the fill and the outline. `data-wash` says which marks
want search painting and `--hit-a` is computed over those only, so a quote never repaints a search's
confidence. What the overlap costs is cosmetic: `[data-wash]`'s `padding-bottom: 2px` makes the
shared fragment 2px taller, so the fill steps down across the hit and back up. Both kinds share
`data-hit-open`; pressing either gives the shared run the quote's purple fill and full ink ring,
with the search's coloured bottom band still visible.

#### Before 2026-10-03: an outline

From 2026-09-07 a quote was a green outline and a search hit a slate fill, also Greg's call
(2026-09-06, report 1Z), made when the alternative on the table was a yellow wash that would have
cost search its hue channel. That write-up ended *"If a later design finds it needs a fill for
quotes after all, the reason this was chosen has been lost."* It was not lost: he looked at both for
a month and preferred the other. What that month measured is still used above (two tiers, the fade,
`box-shadow` reserving no layout, caps only on the true ends, which is how the search outline is now
drawn). The whole of it is in
[260907c](../plans/260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md)
and [260911a](../plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md).

### The bar hides what is below it

Since 2026-09-03, and it took that from the glossary along with everything else here:
**below the bar is not a second group, it is not on screen**, and a line under the track says how
many are hidden and that dragging left brings them back. The argument, Greg's words, and the
reference-list case it reverses are all in
[glossary.md § It hides what is below it](glossary.md#it-hides-what-is-below-it-since-2026-09-03);
the rule itself is [`src/web/threshold.ts`](../../src/web/threshold.ts), shared with the glossary
and search, and it is where **a quote scored on neither axis survives every position of the bar**.
That last one matters more here than next door, because the quotes prompt *permits* omitting a
score.

### The bar's positions are the scores, not a grid

`?bar=` keeps the glossary slider's four properties — the number and the count on screen, the foot
line saying how many are hidden, and a reset — and it does **not** keep its continuous track. The
stops are `barStops`: nothing, then every distinct `max(importance, striking)` the list contains.

That replaced a `0.05`-stepped slider after a cross-family review showed the continuous version could
not keep its own promises, in three separate ways that are all the same way — a track whose positions
are arithmetic rather than data:

1. **The right-hand end kept a band, not the top.** It was the top score rounded *down* to the
   step, so priorities of `.62`, `.61` and `.20` gave an end of `.60`, leaving two quotes that are
   not tied and calling them the top-scored ones.
2. **`?bar=0.63` was accepted against a `step=0.05` track**, so a link could put the thumb somewhere
   it could not be dragged. `snapToStop` now brings any arriving number onto a real position.
3. **Most positions changed nothing.** Between two real scores there is nothing to hide, so most
   of a drag was dead travel with a number moving over it.

Now every adjacent pair of stops shows a different list — asserted, not claimed — and both ends mean
exactly what they say: hard left shows everything, hard right shows the quotes tied at the top score
and never nothing, because the top stop is a real quote's own score.

`canPrioritise` asks the stops rather than asking whether scores exist, for the same reason: a list
where every quote scores the same has one stop above nothing and that stop shows all of them, so the
order would be offered, the slider drawn, and no position on it would ever hide anything. The
glossary needs a longer version of this question, because its stops are a grid rather than the
scores themselves ([glossary.md](glossary.md#prioritised-which-is-now-the-default)).

`?bar=` has **no default of its own**, so "absent" keeps meaning *nobody has touched this*.

**`?rank=` and `?bar=`, not `sort` and `gate`.** Those names are the glossary's and search's, both on
`/read/<slug>` — [url-state.md](url-state.md#the-librarys-own-five) records what distinct names are
worth.

## The reason is behind a button

Greg, 2026-08-31, on what should sit under each quote besides the quote:

> with reason as a tooltip

Which is a stronger answer than it looks. Asked *why this quote*, the obvious reply is a description
of the page the reader is looking at — *"the author says here that…"* — the register the glossary
spent a whole rewrite fixing in `senseHere`
([§ A prompt ban relocates a register](glossary.md#a-prompt-ban-relocates-a-register-it-does-not-delete-one)),
and here it is not merely tempting but the natural reading of the question. Keeping it off the row
means the list a reader scans is prose and nothing else. The prompt still bans the register, because
relocating one is not deleting one.

**A separate ⓘ button beside the row, not a tooltip on the row itself.** GPT Sol's amendment: an
uncontrolled hover tooltip does not exist on a device with no pointer, and a trigger nested inside
the row's own button is invalid HTML. So the tooltip is *controlled* — hover and focus open it
transiently, a tap or click pins it — and the row stays one big target. `Tooltip.tsx` and never a
`title=` attribute, which does not open on keyboard focus ([tooltips.md](tooltips.md)).

**On every row since 2026-10-03**, where it used to be drawn only when the model gave a reason: the
card now ends with who chose the line and when, which every row has
([§ Who and when](#who-and-when)).

## Your highlights are rows too

Since 2026-10-03 a reader's own highlights are rows in this band, among the model's quotes, and
every row says who put it there and when. Greg, asked whether a highlight belongs in Quotes
(spya-ma5h9b):

> A yeah that sounds good. The only hesitation I have is that one might want to highlight the text
> and add a comment or something. I don't know if there's a way for them to show up in both, or
> maybe we keep it simple and just say that comments are block level and highlights show up
> alongside quotes. They should obviously have a different color if it's from me, and they should
> have a tooltip. Actually, quotes should as well, maybe saying when it was applied and whether it's
> AI generated or human highlights. Use your judgment. Let's try and avoid making things too complex.
>
> — Greg, 2026-10-03

Plan and review: [261003h](../plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md).

**A highlight with a note shows up in both places, and nothing was built to make it so.** A
highlight *is* a comment with a colour ([261003e](../plans/261003e-span-highlights-with-a-colour.md)),
so the same row is listed in the comments drawer because it is a comment, shown in the margin when it
has words, and listed here because it has a colour. The row here carries a small pencil when the
comment has a `body`, its card shows the note, and pressing it opens the comment. Greg's simpler
fallback, comments on whole blocks only, was passed over because it is the bigger change: comments
on a selection have existed since 2026-08-28 and readers have them.

**What counts: a comment on a selection, with a colour, that is not a Referee placement**
(`isReaderRow` in [`quote-band-rows.ts`](../../src/web/quote-band-rows.ts)). An uncoloured comment
or a bookmark never said the words were worth keeping; colouring it from its box makes it a row. A
comment with a `criterionId` is a judgment on a criterion
([comments.md § The referee's own placement](comments.md#the-referees-own-placement)).

**The row.** A bar down its left edge in the highlight's own colour at full strength
(`--hl-*-solid` in `tokens.css`, with light twins), the word *yours* for anyone who cannot tell four
colours apart, and the comment's stored `quote` in the same `<blockquote>` a quote gets, because
they are the article's characters. No scores and no "why".

### Interleaved by block, and never by `start`

In *in order* and *prioritised* the two kinds are one list in reading order. **The order is decided
by block only; inside one block the reader's rows come first**, in their own `start` order, then the
model's in theirs. That is sometimes the wrong order within a single paragraph, and it is deliberate:
`Quote.start` is an offset into `block.text` and `Comment.start` an offset into the block's rendered
text ([comments.md § The offset space](comments.md#offset-space)), so comparing them would be right
on most paragraphs and silently wrong wherever there is markup or maths. A highlight whose block a
re-extraction took away is listed last.

In *most important* and *most striking* the reader's rows come first as one group, in reading order,
then the model's as ranked. They have no score, and "unscored last" would bury the lines the reader
chose.

**The bar never hides a reader's row and never counts one.** `5 of 14` is still the model's list;
the reader's are said beside it, `5 of 14 + 3 yours`, and the band's (i) says `14 quotes + 3 yours`.

### What stays the model's only

`QuoteBandRow[]` is built at render, for the panel's markup and nothing else (`bandRows`, from
`shownAiQuotes`). `rankQuotes`, `visibleQuotes`, `markedQuotes`, `effectiveRank`, `barStops`,
`barNote`, `barToReveal`, `steppable` and the ‹ › stepper, `?quote=`, `data-quote-row`, the card on a
quote in the prose, the spine's strip, Skim, and the stored and public `Quotes.quotes` are all still
`Quote[]`. A highlight has no quote id and its own selection state, `?note=`; letting it into any of
those would put two id spaces behind one parameter.

So **pressing a reader's row is the drawer's jump** (`jumpToComment`): go to the passage and open the
comment's box. The panel clears `?quote=` in the same tick, or the quote selected before would stay
lit under the dialog and come back on Escape.

**Owner only.** The rows are a prop on the owner arm of `QuotesAccess` and `never` on the visitor's,
and `Reader` builds them from the owner capability's comments, not from its merged `comments`, which
on a shared link is the sharer's public list. They are drawn as soon as there are any, including
before there is a quote list; the status and the offer to choose the quotes stay under them.

### Who and when

Every row has the ⓘ, and its card ends with one line in the app's own face
([fonts.md](fonts.md)): the model's reason, in the model's face, or the reader's note, in the
reader's, sits above it.

| row | the line |
|---|---|
| a quote with `addedAt` | *Chosen by the AI · 2 Oct 2026, 09:10* |
| a quote stored before 2026-10-03 | *Chosen by the AI · on or before {the list's `generatedAt`}* |
| a highlight | *Your highlight · saved 3 Oct 2026, 14:02* |

The card on a quote in the prose ends with the same line.

**`Quote.addedAt` is the quote's own time**, set in `buildQuotes` from the one timestamp the run also
writes as the list's `generatedAt`. Greg, the same day: *"Store when it happened."* The list's
`generatedAt` could not do the job, because every Find more overwrites it. A quote keeps its
`addedAt` across an append, and across a replace that hands it its old id (`InheritedQuote`).

**An older quote has no `addedAt` and is never given one.** The list's `generatedAt` is an upper
bound on when it was chosen, not the time, so the line says *on or before*; writing the bound into
the field would turn it into a claim. A replace that inherits an id inherits the absence too. The
field is in the `quotes` jsonb, so there was no migration, and it enters no hash, no freshness test
and no dedupe.

**The public projection carries both**, `addedAt` on each quote and `generatedAt` on `PublicQuotes`,
because a visitor's card draws the same line.

**A highlight's date is when the comment was saved** (`createdAt`), and the line says *saved*. A
comment coloured a week after it was written keeps its first date; when the colour went on is not
stored.

### Deferred

- Stepping (‹ ›, ← →) through highlights as well as quotes: one selection model for two id spaces.
- Highlights in the spine's quote strip.
- A visitor seeing the sharer's highlights here, and what that row would be called.
- A time for a recolour.
- Filtering the band to "only mine", or by colour.
- A shared rendered-text position for quotes, which is what an exact interleave inside one block
  would need.

## The stage

The `quotes` artefact (`data/<slug>/quotes.json` until 2026-09-05), stage 5h, in `STEP_ORDER` and **not** in `DEFAULT_INGEST_STEPS` —
everything after `arc` is a thing somebody asks for. In `FORCE_ONLY_WHEN_NAMED`.

```
POST /api/jobs { "slug": "…", "steps": ["quotes"] }
```

which is what the panel's button does, and is the only way in — the stage's own command line was
deleted on 2026-09-01 ([setup-dev.md § The pipeline stages](setup-dev.md#the-pipeline-stages)).

### It starts itself when you press the mode

Since 2026-09-02, pressing **Quotes** in the bottom bar on an article that has never had one starts
the job — no second button. Only a *press* does: a pasted `?mode=quotes` link, a Back step, and a
link in from the metadata page all show the empty state and its button, and spend nothing. A press is
recorded as data by the bar itself ([`src/web/activation.ts`](../../src/web/activation.ts)), because
a mount is not a click.

The loop that made Greg choose a button in the first place —
[glossary.md § That decision was reversed](glossary.md#that-decision-was-reversed-on-2026-09-02-and-the-loop-is-still-closed-structurally)
— is closed structurally: one automatic attempt per `(slug, step)` per tab session, claimed before
the request goes out. The two verbs exist for the same reason: `ensure` is unforced and is what
**both** the automatic run and the empty state's button call, because `work_key` is computed from the
request and two keys are two paid jobs; `regenerate` is forced and is **Find more** beside a
result that is already there — and, on a stale one, *Choose them again* (§ Find more
appends).
[`src/web/useAutoRun.ts`](../../src/web/useAutoRun.ts).

An automatic run uses the reader's profile, as does *Choose them again*; only **Find more** asks in
the list's own recorded setting (§ Find more appends, below). The *Use your profile* checkbox, and
the *Using your profile* sentence an automatic run showed in its place, were removed on 2026-09-13
([reader-profile.md § No control, one label](reader-profile.md#no-control-one-label)).


**It is a converted step**, like `sketch` and unlike its eight other neighbours:
`generateQuotes` writes nothing and hands the artefact back, and the caller decides — the step
returns it as `parts`. A step that wrote `<dir>/quotes.json` inside `run`
works on a laptop and cannot work through a store that puts the artefact in a Postgres column.

### Find more appends. Only a stale or outdated list is replaced.

**Since 2026-09-11.** Until then it replaced, on the ideas' reasoning that a piece has a dozen
quotable lines and running the step again already *is* "choose them again". Greg asked for the
opposite twice — [report 27](../user-feedback/260905_2052-a-button-to-find-more-quotes.md), where
the answer was a bigger count, and then SPIDERYARN-READING2-2W:

> Remove the "Choose them again" button, and add a "Find more" button

So a forced run is now the glossary's shape: **the state of the previous list decides whether it
appends or replaces**, and `existingFor` in [src/quotes.ts](../../src/quotes.ts) is that decision.

| previous list | a forced run |
|---|---|
| none | writes a list of its own |
| written from this same article by the current prompt | **appends**: every quote keeps its words, scores and id; the model gets the taken lines as *already on the list* and is asked for up to `count` more; a new line overlapping an existing one is dropped, whatever its length |
| written from this same article by an **older prompt** (*outdated*) | **replaces**, stamped current; a quote chosen again in **exactly** its words (after `normaliseQuote`) **in the same block** keeps its id, every other id is fresh |
| the article has moved since (*stale*) | **replaces**, and mints every id fresh — an id carried across would point a reader's `?quote=` link at words from a different version of the piece |

**An outdated list is rewritten, since 2026-09-24** (SPIDERYARN-READING2-3C, decided on Greg's
delegated authority; [260924d](../plans/260924d-choose-them-again-on-an-outdated-quote-list.md)).
From 2026-09-11 it was appended to under its older stamp, so that the first Find more on every list
written before `quotes/4` would not silently replace it. Then `quotes/6` changed what a quote *is* —
a passage long enough to stand on its own — and an append cannot deliver that: the old short span
wins every overlap, so the longer version of it is dropped (GPT Sol, 260912e finding 1). So an
outdated list is the second state, beside a stale one, where a list of its own is the honest action.
Since 2026-09-29 it has no banner (Greg, SPIDERYARN-READING2-55: *"it's not worth bugging the user
about it"*; [260929c](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md)) —
re-running is in Metadata, and the foot shows only a run's progress or failure. Find more is not
drawn — on that list Find more would send a rewrite under an append's name. **What the reader gave up**: an outdated list
can no longer be extended in place, and today that is every list written before `quotes/6`. The
alternative — both buttons, and a request field saying which — was passed over as a second mechanism
beside the state-decided one, for the privilege of appending to a list appending cannot fix.
`isOutdated` is the one predicate: the read path's `outdated` and `existingFor` both call it, so
within one build the banner and the branch cannot disagree. It means **older**, not different — a
newer or unparseable version counts as current, so a rollback never rewrites a newer list with an
older prompt. **Across a deploy they can disagree**, and that was accepted: a prompt bump landing
while a Find more is queued turns it into a rewrite, which is the exposure a stale list has always
had (an article re-extracted between click and run). Closing it needs the verb in the request —
260924d § GPT Sol's plan review, F1.

**A different profile does not refuse, made honest at the stamp rather than by refusing.** Find more
sends the list's own profile setting and the artefact keeps the `profileHash` of the pass that
started it, so the only way two profiles' choices meet in one list is a reader who changed or
deleted theirs since — the one state where the badge already says the list was written for a
profile that is not theirs now, and the kept stamp keeps it saying so. **Deletion counts as a change
here and nowhere else**: the shared `profileIsStale` treats a cleared profile as no reason to
rewrite, which is right for an artefact that replaces and wrong for one that appends an unprofiled
pass under the old stamp (`withProfileChanged`'s `clearedCountsAsChanged`, GPT Sol). GPT Sol objected to both as provenance written
falsely; Fable arbitrated for this shape. [260911a](../plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md)
§ What the plan review changed.

**An append that adds nothing is written, not thrown.** `lastAdded: 0` on the artefact, and the foot
says *"Nothing more worth keeping turned up."* — without it, a Find more that found nothing looks
exactly like a button that did nothing ([silent-success.md](../reusable/silent-success.md)). `passes`
counts the runs; `discarded` and `elapsedMs` accumulate across them. The list is capped at
`MAX_QUOTES_TOTAL` (120) in [types.ts](../../src/types.ts); a pass never asks for more than the room
left, at the ceiling no call is made, and the foot says so instead of offering the button.

**The command bar presses Find more too, since 2026-10-04** — *Quotes › Find more*
([reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar)). Its row is
drawn under the guard the foot's button is — settled, a list, not stale, not outdated, under the
ceiling (`quotesAppendOnOffer` in [find-more.ts](../../src/web/find-more.ts), which `Foot` reads) —
and the band makes the press through the button's own function, in the list's own profile setting,
only when nothing is out: no job — on a job list asked for after the press, not the one the tab
already had — no *Starting…*, no failure. That includes a refused POST, where
the foot itself still shows the button under the server's sentence; the command leaves that press to
the reader.

**What the reader gave up** is a whole rewrite of a current list, including one for a new profile —
*Choose them again* was the only way to throw a current list away. It survives on the **stale**
banner; the **outdated** banner, the other state where extending cannot give the reader what the
current prompt would, went on 2026-09-29
([260929c](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md)), and that list is
rewritten from Metadata.

**Ids on the outdated rewrite are inherited by exact words, and nowhere else.** This is the
same-article rewrite `idsByText` was kept for. The article has not moved, so an old quote's words are
still where they were, and a quote the current prompt chooses again in exactly those words is the
passage the reader's `?quote=` bookmark named. Most will not match — `quotes/6` chooses longer
passages — and those links go dead, which opens the list with nothing selected. **A longer passage
containing the old words does not inherit**: that would send a bookmark on one sentence to a
paragraph the reader never chose, and "contains" can admit several candidates where exact admits one.
A dead `?quote=` opens the list; a wrongly inherited one opens somebody else's words wearing the
reader's bookmark. **The key includes the block id**, because the same sentence can occur in two
blocks and `locate` takes the first — a text-only key would move a bookmark on the second to the
first. A stale rewrite inherits nothing, for the reason in the table.

### Freshness

`stamp` in [`pipeline.ts`](../../src/pipeline.ts): `inputHash` (`articleFingerprint` — blocks, tree
and the metadata head), `promptVersion`, `model`. **Not `profileHash`**, which is where this parts
company with `ideas`: there the profile decides what *assumed* means, so an older artefact answers a
different question. A profile changes which *lines* are worth keeping here too, but it cannot change
what the author wrote — so the read path raises the banner and the reader decides. That is the
glossary's position.

**A stale quote list matters more than a stale anything else in this band.** A stale glossary entry
is a definition that still reads correctly; a stale quote carries a block id that may be gone *and*
words that may no longer be in the piece. It is the one artefact here whose staleness can make it
false rather than merely dated, which is why the banner sits above the list and says so plainly.

### Effort, and the cache

`STAGE_EFFORT.quotes = "medium"`, `ARTICLE_RENDERER.quotes = "text"` — so this stage is
**cache-compatible with `glossary`** and with nothing else: same model, same effort, same renderer,
same bytes.

**Compatible is all it is.** A cache entry is only *written* when a later step in the same job would
read it (`cacheArticle` in [`pipeline.ts`](../../src/pipeline.ts)), and a reader pressing *Find the
terms* and then *Choose the quotes* has made two jobs minutes apart. The saving is real for
`steps: ["glossary","quotes"]` in one job and for nothing else — the plan claimed more and GPT Sol
caught it. It is still a constraint: moving either stage's effort ends the compatibility silently.

`medium` is a guess, like every effort choice that has not been through
`evals/results/effort-vs-quality.md`.

## Five ways to break this quietly

1. **Store the model's string instead of the block's slice.** Every fold `findQuote` makes then
   becomes a word the author did not write, and nothing anywhere errors.
2. **Use the forgiving pass for verification.** `findQuote(text, quote)` without `"spaced"` accepts
   a word split in two. It is the right call in the browser and a false claim on the server.
3. **Search all the blocks instead of `evidence`.** A line lifted out of a footnote or a reference
   list would resolve to a real block and arrive wearing the same verification as every other row.
   `generateQuotes` passes one variable to both the prompt and `buildQuotes` for exactly this reason,
   and `tests/block-policy-prompts.test.ts` holds it.
4. **Sort the list in the artefact.** `quotes.json` stores document order, so `?rank=document` means
   the article's order and not the last writer's preference — the glossary's second trap, one door
   along.
5. **Let `max` become a product in one of the places it is computed.** `priorityOf` is one function
   and the panel, the count, the track end and the visible list all call it. A second copy is how the bar
   comes to say `5 of 14` over a list of six.

## The first real run, and what it said

`data/openai-huggingface`, 4,192 words, 2026-08-31. Five quotes kept in 11.9 seconds.

**`unfound: 0`.** Not one line the model offered was missing from the article — which is the number
this whole stage is arranged around, and the best answer it could have given. `otherVoice: 2`, which
on a piece that quotes agent transcripts at length is the check doing its job rather than a fault.

**It moved the bar.** The five `max(importance, striking)` values came back `0.70`, `0.75`, `0.75`,
`0.85`, `0.90` — clustered high, exactly as the argument for `max` predicts — so a starting bar of
`0.70` showed **every quote** and the panel opened on a foot line saying nothing was hidden.
`0.80` left two of those five on screen. One article is a better-supported guess and not a
measurement, and the slider is still the feedback loop. (On 2026-09-15 the default came down to
`0.60` — the bullet under § The bar above.)

**And 11.9 seconds against a 120-second budget**, which is a `STEP_BUDGET_MS` guess with an order of
magnitude of headroom in it. Worth leaving alone — one sample, and being under is the cheap way to be
wrong — but worth knowing.

## What is still open

- **One article is one article.** `medium` effort rests on that single run. The bar's `0.60` rests
  on four local quote lists (260915d), which is more but still few; production has not been
  measured.
  `data/writes/quotes.json` still does not exist, so `quotes.json` is off `GATE_FIXTURES`
  and the filesystem-to-Postgres round trip is still asserting that an absent artefact stays absent.
- **The count has risen twice on the strength of an argument, not a measurement.**
  `suggestedQuotes` asks for one per ~200 words clamped 10–40 since 2026-09-11 (*"Try and find more
  quotes by default"*), after one per ~300 clamped 8–32 from 2026-09-05 and one per ~600 clamped
  4–16 before that. Nobody has yet read a 40-quote list and said whether the tail is worth having;
  the bar hides it, which is what makes the number affordable and not what makes it right.
  `STEP_BUDGET_MS.quotes` is 240s with it, also unmeasured as a scheduling budget — paid passes have
  taken 11.9 seconds for five quotes and 14–27 seconds for 15–22 quotes.
- **`quotes/4` leads with importance** (*"emphasise important rather than striking when
  highlighting them"*): the prompt still takes either reason, and `max` still combines the scores,
  but it tells the model to look for the lines the argument rests on first and to keep a merely
  well-put one only when it is exceptionally so. Whether the lists actually shifted is unmeasured.
- **`quotes/5` asks for lines that say different things** (*"avoid ending up with loads of quotes
  that say basically the same thing"*): one paragraph in the system prompt, and Find more's taken
  list now rules out a taken line's point in other words, not only its sentence. Prompt only —
  spans cannot see a restatement. Also unmeasured;
  [260911e](../plans/260911e-quotes-prompt-asks-for-diverse-lines.md).
- **`quotes/6` asks for quotes that stand on their own** (*"the quote is not self-sufficient. It only
  has real meaning in the context of the wider block that it's part of"*). A quote is a **passage, not
  a line** — one sentence, several, or the whole paragraph — from the prompt's first sentence; `LONG
  ENOUGH TO STAND ALONE` follows straight after what earns a quote; and `MAX_QUOTE_CHARS` went from 400
  to 1,200. **Neither half works alone**, and that was measured: most paragraphs in a paper are over
  400, and a first wording that only added a section near the bottom left the model choosing single
  sentences (median 148 → 169). The reframing took it to 202–255 over two samples, with whole
  paragraphs still rare. The prompt states the constants rather than its own numbers, and the answer's
  token allowance is computed from the ceiling at one token a character (`answerTokensFor`). **Old
  lists keep their short quotes until the reader presses *Choose them again***: Find more's taken
  spans win every overlap, so it cannot lengthen them, and since 2026-09-24 an outdated list is
  rewritten by a re-run instead — from Metadata since 2026-09-29 (§ Find more appends). Nothing rewrites one unasked. One article, three samples;
  [260912e](../plans/260912e-quotes-long-enough-to-stand-on-their-own.md). **Longer quotes mark more
  of the prose**, which makes the density point below more pressing — and make the known gap likelier:
  text inside `<svg>` or `<math>` is counted but not wrapped (`annotateHtml`), so a quote crossing a
  formula has a break in its fill, and one that starts or ends inside one can lose a rounded end.
- **The density with Find more is unlooked-at.** The default rank marks every quote in Plain, and a
  list can now grow to 120.
- **`validateHits` (search) and `validateOccurrences` (ideas) have the same two bugs** this stage was
  fixed for: both call `findQuote` with the forgiving pass and both store the model's string. Their
  quotes are shown in a results list rather than presented as the author's chosen lines, so the harm
  is smaller — but it is the same harm. A separate landing, noted here because this is where the
  shape of the fix is written down.
- **No copy button.** Worth having; it needs a decision about whether it copies the quote, the quote
  and a citation, or a deep link. [`src/web/Tweets.tsx`](../../src/web/Tweets.tsx) already has a
  private `CopyButton`, with its card and its touch behaviour.
- **Keyboard traversal of the list is ← / → since 2026-10-02**, not ↑ / ↓, which still belong to the
  article ([keyboard.md](keyboard.md) § ← / → in Quotes). The rows and the ⓘ are ordinary tab stops
  as before.
- **Nothing generates quotes for the `example/` fixture**, consistent with the glossary and equally
  unsatisfying.

## See also

- [glossary.md](glossary.md) — the mode this took its shape from: the prioritised order, the
  threshold slider, and the condition attached to keeping model scores
- [ideas.md](ideas.md) — the mode this took its lifecycle from until 2026-09-11: replaces rather
  than appends, one verb, no DELETE. Find more swapped the first for the glossary's append
- [search.md](search.md) — where `Found`, the outline and the rail lane come from
- [block-ids.md](block-ids.md) — why a passage is a block id and never an offset
- [url-state.md](url-state.md) — `?mode=quotes`, `?quote=`, `?rank=`, `?bar=`
- [security.md](security.md) — the sanitiser, and the `hit` class this mode's marks made it reserve
- [architecture.md](architecture.md#pipeline) — where stage 5h sits

---

Up: [reading-view-overview.md](reading-view-overview.md)
