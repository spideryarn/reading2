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
 │  ▇▇▇▇▇      │ bar 0·80 · 5 of 14    │      ↑ the wash and the    │   │
 │  ▇▇         │ ────────●──────────   │        ┃ border — the SAME │ ▍ │
 │  ▇▇▇▇▇▇     │ 9 quotes are hidden   │        marks a search hit  │   │
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
[`tests/quote-marks.test.ts`](../../tests/quote-marks.test.ts) (what the prose marks).

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
A count in a log is invisible to the person the drop happened to. The other three are editorial rules
of ours that the reader has no stake in, and naming them would turn a disclosure into a changelog.

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
- **The bar starts at `0.80`, not the glossary's `0.30`**, because a product of two 0–1 scores
  clusters low and a maximum clusters high. It started at `0.70` and the first real run moved it —
  see below.
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

- **The quotes reach the prose in every mode and the paragraph bar, the spine rail and the ring in
  none.** `proseFound` in [reader/passages.ts](../../src/web/reader/passages.ts) is the whole of that
  split and carries the argument: a quote's `confidence` is `null`, which `blockStrength` reads as
  certainty, and every quote's `slot` is `0`, which is the first saved search's colour. In quotes
  mode the picked slot *is* the quotes, so nothing there changed.
- **The opening read moved up**, `useQuotesRead` in `OwnedReader`, exactly as the glossary's did in
  2026-08-27 and for the same reason. `useStepJob` and `useAutoRun` stayed in the band deliberately —
  a job subscriber up there holds the engine to its idle cadence for every reader of every article,
  and an activation owner up there could spend a Quotes press after the reader had left the band.
- **A quote is the one mark a tap may fall through.** `NOT_A_BLOCK_SELECTION` in
  [TableView.tsx](../../src/web/TableView.tsx) excludes every `<mark>` because a tap on one already
  means something — except a quote, which nothing acts on. With up to 32 of them on the page in
  Plain, a blanket exclusion would make the best sentences in the piece the ones a finger cannot
  select, and therefore cannot annotate ([touch.md](touch.md)).

**What is still open** is the density: the default `?rank=` is `document`, where `rankQuotes` returns
the whole list and the bar does nothing, so a reader who has never touched the controls meets all of
them. The bar is the control and it survives a mode change, but it is only reachable from inside
quotes mode. Nobody has yet looked at 32 marks at once. See § *An article's quotes are capped*.

Since 2026-09-05 the whole shown list is marked rather than only the *selected* one — until then the
mode drew nothing at all on the
article until you pressed a row, and the slider changed the list without changing the page. Greg,
in the feedback report that asked for it (SPIDERYARN-READING2-1Z):

> skim through it just reading the stuff that is marked

**What is marked is what the panel lists**, and that is one function — `markedQuotes` in
[`QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx), called by the panel and, since 2026-09-08, by
[`useQuoteMarks`](../../src/web/reader/useQuoteMarks.ts) rather than by the band — so the rows and
the strokes cannot come apart, and the bar doubles as the highlight-density control. A row the bar
has hidden with its stroke still on the paragraph is the precise failure
[threshold.ts](../../src/web/threshold.ts) exists to prevent.

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
- **The pressed quote gets the ring**, `mark.hit[data-hit-open]`, which search has always had and
  quotes did not need while there was one mark on the page. It came up in the same layout effect as
  the marks so that no paint could show the ring on one quote and the mark set of another; since
  2026-09-08 `useQuoteMarks` returns both out of **one render**, which has that property by
  construction and left the `derived` lifecycle shape with no caller.

### The stroke, which is how a quote says how much it matters

**Not yellow, and since 2026-09-07 not a wash at all: a quote is drawn as an outline.** Greg
decided it on 2026-09-06, against his own earlier *"maybe a yellow highlighter pen"*:

> Perhaps use another UI convention, e.g. provide a border (i.e. the boundary but not the fill) for
> quotes, perhaps with bold, and use thickness and boldness as an indicator of the Quote priority.
> … Failing that, let's just use a fluorescent-yellow highlighter, and tweak the Search colourings
> to be pastel or something so they have a different feel to them.

The yellow was the fallback and was not needed. It would have cost the hue channel — which carries
*which search found this*, 2026-08-26 — or added a quotes-specific wash, a second way of drawing a
marked passage, which is what this mode was built not to have. **A stroke costs neither, because it
is a channel nothing else in the prose was using. Search fills; quotes outline.** If a later design
finds it needs a fill for quotes after all, the reason this was chosen has been lost.

| Channel | Carries |
|---|---|
| the wash | a search's **confidence** (`--hit-a`) |
| the bottom band's hues | **which search** found it |
| the `::after` glyph | a referee criterion's **direction** |
| **the stroke** | **that this is a quote, and how much it matters** |

**Two tiers, from `priorityOf`.** `quoteTier` (QuotesPanel.tsx, beside `priorityOf`) is heavy at or
above `QUOTE_BAR_DEFAULT` and light below it — so at the bar's resting position every quote on the
page is heavy, and the light ones are what dragging the bar down reveals. The two controls tell one
story: **raise the bar and what survives is exactly the heavier strokes.** Driving it from
`importance` alone would let them disagree, since `?bar=` thresholds on `max(importance, striking)`;
a quote that is merely *striking* clears the bar, so it must also draw heavy.

**A quote with no score at all is light, and still drawn.** It has earned no emphasis, but a quote
scored on neither axis survives every position of the bar (§ The bar hides what is below it), so
leaving it unmarked would be a row in the panel with nothing in the prose.

**Two tiers and not three, and that is a measurement rather than a preference.** Blind pairwise on
the box, 2026-09-07: three tiers at 1/2/3px scored **13/20, which is chance**, with answers
correlating to slot position rather than thickness. Two tiers at 1px and 3px scored **12/12 at both
device scale factors**. Everything involving a middle tier is what fails. A third level would be a
ranking the reader cannot see, which is worse than no ranking.

**Bold is out**, though Greg asked for *"perhaps with bold"*. It does not change the paragraph's
height — measured — but it **re-wraps** the prose, moving the text after the mark by 80px in the
sample. With quotes on a slider, every drag would reshuffle the words under the reader's eye.
`text-shadow` and `-webkit-text-stroke` thicken without reflowing and are rejected too, for the
older rule: the verbatim column is not restyled to advertise our annotation.

**How it is drawn, and the two things that make it work.** `box-shadow`, because it reserves no
layout space at all — measured identical to three decimal places with the ring on and off — where a
border costs inline width per fragment and `outline` is the focus ring. And **the caps are the hard
part**: `annotateHtml` emits one `<mark>` per text node and splits again at every annotation
boundary, so one quote containing an `<em>` is *three sibling elements*, and three closed rings read
as three quotes. So the rules above and below are drawn on every fragment and the inline caps only
on the two carrying `data-quote-start` / `data-quote-end`. The caps are **inset**, because drawn
outside they weld two abutting quotes into one. `annotations.css` § quote strokes has the numbers.

**And quotes stopped being washes at all**, which had to happen first: a quote was a `strength: 1`
hit, and `--hit-a` is the maximum over every mark covering a run, so **a quote lying over a hedged
search hit repainted that hit's confidence at full**. `data-wash` now says which marks want search
painting, and `--hit-a` is computed over those only.

That was a fault in the renderer rather than something a reader could then see: one mode's marks were
on the page at a time, so a quote and a search hit were never drawn over one phrase. The overlap was
a contract `annotateHtml` held, not a state the app could reach — worth being exact about, because
the first write-up of this called it a live bug and it was not one.

**It is one now.** Since 2026-09-08 the quotes are on the page in every mode, so a search hit and a
quote share a fragment whenever they share a phrase, and *"one mode's marks at a time"* is no longer
true anywhere it is written. **Fixing this a day early is what made that change cheap** — had the
wash still been computed over every mark, turning the quotes on everywhere would have silently
repainted every hedged search hit under a quote at full confidence, in the one channel that says how
sure the model was.

What the overlap still costs is cosmetic and known: `[data-wash]`'s `padding-bottom: 2px` makes the
shared fragment 2px taller, so the quote's bottom rule steps down across the hit and back up —
measured at 718.67 against 720.67 in Chrome on 2026-09-08. Not fixed;
[260907c](../plans/260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md)
§ *The step where a quote crosses a search hit* weighed the cheap fixes and found each worse than the
defect, and it is a decision for Greg rather than a bug to be quietly patched.

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
request and two keys are two paid jobs; `regenerate` is forced and is the *Choose them again* button beside a
result that is already there. [`src/web/useAutoRun.ts`](../../src/web/useAutoRun.ts).

An automatic run has nobody to ask about the reader's profile, so it uses it and the panel says so —
*Using your profile* — rather than showing a tickbox it has disabled.


**It is a converted step**, like `sketch` and unlike its eight other neighbours:
`generateQuotes` writes nothing and hands the artefact back, and the caller decides — the step
returns it as `parts`. A step that wrote `<dir>/quotes.json` inside `run`
works on a laptop and cannot work through a store that puts the artefact in a Postgres column.

### It replaces. It does not append.

The ideas' rule for the ideas' reason: a piece has a dozen quotable lines, not an encyclopaedia, so
running the step again already *is* "choose them again". That removes the FORBIDDEN checklist,
`existingFor`, "a stale list is not appended to", `passes` and the `DELETE` route at once.

What it keeps is **id inheritance**: `idsByText` gives a fresh quote the id the old artefact used for
the same words, keyed on a normalised form, so `?quote=` links survive a rewrite. Deliberately
conservative — a sentence returned with one more clause is a different key and gets a new id. A dead
`?quote=` opens the list; a wrongly inherited one opens somebody else's words wearing the reader's
bookmark.

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
`QUOTE_BAR_DEFAULT` ([`QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx)) leaves two of those five on
screen. One article is a better-supported
guess and not a measurement, and the slider is still the feedback loop.

**And 11.9 seconds against a 120-second budget**, which is a `STEP_BUDGET_MS` guess with an order of
magnitude of headroom in it. Worth leaving alone — one sample, and being under is the cheap way to be
wrong — but worth knowing.

## What is still open

- **One article is one article.** `0.80` and `medium` effort both rest on that single run.
  `data/writes/quotes.json` still does not exist, so `quotes.json` is off `GATE_FIXTURES`
  and the filesystem-to-Postgres round trip is still asserting that an absent artefact stays absent.
- **The count doubled on the strength of an argument, not a measurement.** `suggestedQuotes` asks
  for one per ~300 words clamped 8–32, up from one per ~600 clamped 4–16, because the list became
  the marks you skim by and Greg asked for "many more". Nobody has yet read a 32-quote list and said
  whether the tail is worth having; the bar hides it, which is what makes the number affordable and
  not what makes it right. `STEP_BUDGET_MS.quotes` went to 180s with it, also unmeasured — the one
  timing there has ever been is 11.9 seconds for five quotes.
- **`validateHits` (search) and `validateOccurrences` (ideas) have the same two bugs** this stage was
  fixed for: both call `findQuote` with the forgiving pass and both store the model's string. Their
  quotes are shown in a results list rather than presented as the author's chosen lines, so the harm
  is smaller — but it is the same harm. A separate landing, noted here because this is where the
  shape of the fix is written down.
- **No copy button.** Worth having; it needs a decision about whether it copies the quote, the quote
  and a citation, or a deep link.
- **No keyboard traversal of the list**, the same gap the glossary and ideas panels have, for the
  same reason ([keyboard.md](keyboard.md) — ↑ / ↓ belong to the article). The rows and the ⓘ are
  ordinary tab stops, so everything is *reachable*; what is missing is a fast way through.
- **Nothing generates quotes for the `example/` fixture**, consistent with the glossary and equally
  unsatisfying.

## See also

- [glossary.md](glossary.md) — the mode this took its shape from: the prioritised order, the
  threshold slider, and the condition attached to keeping model scores
- [ideas.md](ideas.md) — the mode this took its lifecycle from: replaces rather than appends, one
  verb, no DELETE
- [search.md](search.md) — where `Found`, the wash and the rail lane come from
- [block-ids.md](block-ids.md) — why a passage is a block id and never an offset
- [url-state.md](url-state.md) — `?mode=quotes`, `?quote=`, `?rank=`, `?bar=`
- [security.md](security.md) — the sanitiser, and the `hit` class this mode's marks made it reserve
- [architecture.md](architecture.md#pipeline) — where stage 5h sits

---

Up: [reading-view-overview.md](reading-view-overview.md)
