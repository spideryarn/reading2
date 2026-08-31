# Timeline — when things happened, and how sure the piece actually is

The **eleventh** mode in the band between the spine and the prose, beside [Ideas](ideas-mode.md). It answers
*when did all this happen, and in what order* — for a piece that tells you a story out of order, in
half-dates, and in phrases like "two weeks later".

Greg asked for it on 2026-08-31:

> Create a "Timeline" mode (which can deal with ambiguity about dates, resorting to ordering, and
> indicating the uncertainty)

The clause after the bracket is the whole feature. **A mode that only handled clean dates would be a
`<dl>`.** Every hard decision below is about what to do when the piece does not give you one.

---

## Say the awkward thing first

**A timeline is the most summary-shaped thing we have yet built.** A reader who opens it, reads
fourteen rows, and closes the tab has been handed the article's plot with the prose removed — which
is [the anti-goal](../project/vision.md#anti-goals) stated almost word for word. Glossary and Ideas
are defensible because a list of terms is not the piece; a list of *what happened in order* very
nearly is.

Three things answer it, and they have to be built in, not asserted:

1. **A row is a pointer, not a retelling.** The row carries a date, a mark, and a short label — not a
   paragraph. Everything else is a press away, in the prose, in the article's own words. If a reader
   can follow the story from the panel alone, the labels are too long and we have built a summary.
2. **Chronological order is not the article's order**, and that is the point. The panel deliberately
   shows something the prose does not: the sequence, straightened out. That is a genuinely different
   artefact from the piece, in the way a map is different from a walk. It is *most* useful to someone
   who has read the piece and is trying to hold it, which is the reading this app is for.
3. **The uncertainty is the content.** The thing this panel says that no summary says is *we do not
   actually know when this happened, and here is how sure the article is*. That is a claim about the
   evidence, not a compression of the argument.

If, when we look at it on a real article, the panel reads as "the article in fourteen bullets", it
has failed on its own terms and the labels get shorter — not the objection quieter.

**And the second awkward thing: a hallucinated date is invisible.** A wrong glossary definition looks
wrong. A wrong block id lands you on a paragraph that plainly does not match. `12 June 2019` looks
exactly like `12 June 2019`. This is the highest-consequence extraction we have built, and
[§ Nothing is dated unless the article dates it](#nothing-is-dated-unless-the-article-dates-it) is
the section that has to hold.

---

## What Greg chose

Asked on 2026-08-31, with diagrams:

- **Shape:** an ordered list, like Ideas — every event the same height, no time-to-scale axis. *"A
  two-week gap and a two-year gap look the same."* Rejected: a proportional axis, and a two-zone
  hybrid.
- **What goes on it:** events the piece narrates; undated steps that are still ordered; future and
  hypothetical times. Plus, verbatim: *"leave a bit of room for the agent to exercise its judgment
  about what to include and how"*. **Not** selected: the piece's own dates (published, interviewed).
- **Uncertainty:** *show it in the drawing itself* — marks carry the meaning, with a legend at the
  foot. Rejected: a word plus a hover card, and both-at-once.
- **Scope:** the full mode, run as [engineering-manager.md](../reusable/engineering-manager.md).

Then twice more on 2026-08-31, after the review and the spike had turned up what the first draft got
wrong, and both answers cut rather than added:

- **How much to resolve in code:** *parse the date, fill in the year, stop there.* No relative
  arithmetic, no `basis`.
- **Sorting:** *don't sort by date at all — use the model's reading.*

The one place the answers pull against each other: the mark vocabulary Greg picked included a bar
"drawn to its width", which needs the axis he rejected. Resolved in
[§ The marks](#the-marks-two-brackets-and-what-sits-between-them) — the bar becomes symbolic and fixed-width,
and the duration is said in words beside it.

---

## The test article

<https://www.dwarkesh.com/p/openai-huggingface> — Dwarkesh Patel, 29 Aug 2026, "The Rise and Fall of
Agent Civilizations". It was chosen as the thing to try this on, and it turns out to be close to a
worked exam paper. Every temporal expression in it, verbatim:

| # | The phrase | What makes it hard |
|---|---|---|
| 1 | "Over the course of three months at OpenAI" | a span that contains most of the other rows |
| 2 | "During May, OpenAI was training a model" | a month, not a day — and the event *lasts* |
| 3 | "By May 12, some agents had figured out how to talk" | **"by"** — an upper bound, not a point |
| 4 | "Two weeks later, on May 26, the agents successfully exploited" | relative *and* absolute, agreeing |
| 5 | "Another month later, on June 26, some AIs found an exploit" | relative *and* absolute, and "a month" ≠ 31 days |
| 6 | "by July 4…crashed the package manager" | upper bound again |
| 7 | "On July 7, OpenAI launched tens of thousands of parallel agents" | clean — and year-less, like all of them |
| 8 | "Within a few hours, some of these agents had gotten super desperate" | relative, sub-day, vague magnitude |
| 9 | "By the night of July 8, PHASEONE10841 had discovered…" | upper bound with a time of day |
| 10 | "Within a few hours of the board being created…" | relative to an event that has no date at all |
| 11 | "By July 10, PHASEONE\[big\] was coordinating hundreds…" | same day as #12, different time |
| 12 | "On the morning of July 10, an agent found working credentials" | sub-day ordering against #11 |
| 13 | "By the next morning, July 11, that agent figured out a way" | relative + absolute + sub-day |
| 14 | "On July 11, a bunch more agents were kicked off for evaluation" | same day as #13 |
| 15 | "over the course of the next day, the swarm crawled deep" | a span defined only relatively |
| 16 | "At some point on July 12, the transcripts seem to show many dying" | **the article says it is unsure** |
| 17 | "By July 13, Hugging Face locked down the credentials" | upper bound |
| 18 | "from July 13 through July 19, agents set their sights on…" | a genuine span with both ends stated |
| 19 | "2026-07-19…cloud service credentials \[are\] used" | the only expression carrying a year |
| 20 | "A couple weeks ago, \[I interviewed Ryan Greenblatt\]" | about the *piece*, not the story — and Greg excluded these |
| 21 | "the six-day sprint during which he assembled the report" | a duration with no anchor |
| 22 | "just six months ago, this incident feels like…" | relative to publication |
| 23 | "I continue to expect rapid advances over the next six months" | a **prediction** |
| 24 | "I don't think this is the final warning shot we'll get" | future, with no time in it at all |

**Nineteen of the twenty-four are year-less.** Row 19 is the only one that states 2026, and it does so
inside a quoted log line. So "infer the year from the publication date" is not a nicety on this piece
— it is the difference between a timeline and nothing. See
[§ The reference frame](#there-is-no-publication-date-until-stage-2-is-taught-to-keep-one).

Rows 3, 6, 9, 11, 17 all use **"by"**, which is an upper bound: *at or before*. A model asked for "the
date" will return a point and silently throw away the fact that the event could have happened days
earlier. Five of twenty-four, on one article, so it is not an edge case.

Row 16 is the best row in the piece: *"the transcripts **seem to** show"*. The article is telling you
its own confidence, and a timeline that renders that identically to row 7 has thrown away the one
thing the author was careful about.

### It is ingested, and the block ids are real

Run on 2026-08-31: `npm run fetch`, `npm run extract`, `npm run blocks`, `npm run toc` →
`data/openai-huggingface/` (95 blocks, 1 heading, 90 text, 4 quote). The tree build **failed on the
first attempt** with a boundary error out of `src/toc.ts` and succeeded on the second, which is worth
knowing before anyone reads a failure here as their own bug.

So the fixture does not have to be invented. The hard cases have addresses:

| Block id | What is in it |
|---|---|
| `spya-gb7ze2` | "Over the course of three months" — the span containing everything |
| `spya-ekhrbu` | "During May, OpenAI was training a model" |
| `spya-v9detz` | **three expressions in one block**: "By May 12", "Two weeks later", "on May 26" |
| `spya-g9tjds` | "Another month later, on June 26" and "crashed the package manager by July 4" |
| `spya-m24kgb` | "Within a few hours of the board being created" — relative to an **undated** event |
| `spya-xvkm3j` | "by July 10, PHASEONE\[big\] was coordinating hundreds" |
| `spya-sjjbur` | "On the morning of July 10" and "By the next morning, July 11" |
| `spya-r4jn5b` | "At some point on July 12, the transcripts **seem to** show" |
| `spya-ebtbnm` | "from July 13 through July 19" — a real span, in a **quote** block |
| `spya-khwx0h` | "2026-07-19" — the only year in the piece, inside a quoted log line |
| `spya-chdu2z` | "at some point **after** July 12" — a lower bound *and* a hedge |
| `spya-peudft` | "lasted over a month until the message volume got so high" — an open-ended span |
| `spya-z6c3dr` | *"We're getting a little bit ahead of the story"* — the article saying out loud that it is out of order |
| `spya-h6yxz3` | "A couple weeks ago, I interviewed Ryan Greenblatt" — about the piece, excluded |
| `spya-b0wbhk` | "I've spent the last three days reading through these reports" — also about the piece |

Three things this turned up that the earlier read of the article had missed, and each is a case the
implementation has to handle:

1. **`spya-v9detz` holds three expressions and at least two events.** One block, several rows. Any
   design where an event maps to a block breaks here.
2. **"After July 12" appears twice** (`spya-c2bkgz`, `spya-chdu2z`) — lower bounds, the mirror of the
   five "by" upper bounds, and the plan's interval model handles them only because `earliest` and
   `latest` are independently nullable.
3. **`spya-z6c3dr` is the article flagging its own non-linearity.** The piece recounts the same three
   months three times, once per civilisation, which is exactly the input that will drive the
   `orderConflicts` counter up. On this article a high count may mean the mode is working.

---

## The data model

**Revised 2026-08-31 after the review and the spike, and after two decisions from Greg.** The
history is in [§ What the review and the spike found](#what-the-review-and-the-spike-found-2026-08-31);
this section is what we are building.

Greg's two calls:

> **Parse the date, fill in the year, stop there.**
> **Don't sort by date at all — use the model's reading.**

Between them they delete the three parts of the first draft that the review said were unsound, rather
than repairing them.

### The model supplies evidence; code supplies dates

This is the whole architecture, and it is the fix for
[the safety hole](#what-the-review-and-the-spike-found-2026-08-31). The model is **never** asked for
a normalised date. It is asked for the article's own temporal words, and a small deterministic parser
turns those words into a date.

```
   MODEL RETURNS                          CODE PRODUCES
   ─────────────                          ─────────────
   phrase: "By the next morning,          earliest: null
            July 11"                      latest:   "2026-07-11"
   blockId, quote                         extent:   "instant"
   order, modality                        yearFilled: true
```

Three things fall out of this that no amount of prompt-writing could have bought:

1. **A date that is not in the article cannot be displayed**, because the only route to a date is the
   parser, and the parser reads the article's characters. This is what
   [§ Nothing is dated](#nothing-is-dated-unless-the-article-dates-it) actually needed.
2. **`basis` disappears.** It was a coin toss — 16 `"stated"` in one spike run, 13 `"derived"` in the
   next, off the same prompt — because in "July 7" the month is stated and the year is derived and
   one field cannot say both. Now the code knows exactly which component it filled in, so it is a
   fact rather than a judgement.
3. **The bracket bug becomes harmless.** `[F]rom July 13 through July 19` defeated
   `findQuote` on the model's normalised copy. The parser reads the **block's own text**, so the
   brackets are ours to skip rather than the model's to reproduce.

### `When`

```ts
interface When {
  /** Earliest this could have been. null = unbounded below ("by 4 July"). */
  earliest: string | null;      // ISO, day precision
  /** Latest this could have been. null = unbounded above ("after that"). */
  latest: string | null;
  /** Does the event FILL this interval, or sit somewhere inside it? */
  extent: "instant" | "extended";
  /** The article's own words this was read out of. Located in the block, by us. */
  phrase: string;
  /** Where in the block `phrase` starts — so the panel can show it and the reader can check. */
  at: { blockId: BlockId; start: number; end: number };
  /** True when the parser supplied the year from the publication date. */
  yearFilled: boolean;
}
```

`when` is **nullable on the event**. An undated event has no `When` at all, rather than a `When` full
of nulls and a fake `phrase` — which is what the spike produced five times per run, with
`basis: "inferred"` on rows carrying no date, where the field meant nothing.

`extent` stays. It was the most stable field in the spike — correct on both showcase rows in both
runs, never flipped — and it is the difference between "this lasted six days" and "this took a moment
and we cannot say which".

**No `basis`. No relative arithmetic. No `granularity`.** Month precision is carried by the interval
itself: "During May" is `2026-05-01 .. 2026-05-31, extended`, which is what it means.

### Relative expressions are shown, not solved

"Another month later" is displayed as *"another month later"* — the article's words, in the date
column, where a date would otherwise be. We do not compute ~26 June.

Greg's call, and the spike is why it is cheap: the model obeyed the arithmetic ban **completely** —
nine relative structures per run, zero computed dates — so we already know it will hand back the
phrase rather than a number. What we lose is one row on the test article reading "another month
later" instead of "~26 June". What we do not build is offset ranges, anchor edges, cycle detection by
strongly-connected components, and the four-deep resolution chain the spike produced.

It also removes an invention we would otherwise have shipped: **"a few hours" came back as
`{ value: 3, unit: "hour" }`**, and the 3 is the model's, not the article's. Under this design that
number never exists.

### The event

```ts
interface TimelineEvent {
  id: TimelineEventId;               // minted once, preserved across runs
  label: string;                     // SHORT. a handle, not a retelling
  when: When | null;                 // null = the article gives no date
  order: number;                     // the model's reading of the sequence — THE SORT KEY
  modality: "happened" | "predicted" | "hypothetical";
  occurrences: TimelineOccurrence[]; // block id + quote, validated as Ideas validates them
}
```

---

## Ordering: the model's reading, and the dates as a check on it

Greg's second call. **The list is in the order the model says the story goes.** Dates hang off the
rows as labels; they do not move anything.

```
  sort by (modality partition, order)
```

That is the whole function. Predictions and hypotheticals sort after everything that happened;
within each partition, `order`, with the event's index as a stable tie-break for duplicate values.

The first draft had a four-rule precedence, a conflict counter and a dozen edge cases, and the review
was right that even that asserted more than the evidence supports: an event known only to be "by 4
July" may have happened on the 1st, and placing it at the 4th claims otherwise. The proper fix is a
partial order with a topological sort. **The cheaper fix is not to sort by date at all**, which is
what we are doing.

### The dates still get compared — as a counter, not a sort key

This is the part worth keeping from the discarded design, and it now costs nothing.

Where two events both carry dates whose intervals prove an order — `A.latest < B.earliest` — and the
model put them the other way round, that is a **definite contradiction between the article's own
dates and the model's reading of the sequence**. It changes nothing on screen. It increments
`orderConflicts`, and it is the only signal we have that the model has misread the chronology.

The test article is the reason to want it: it recounts the same three months three times, once per
civilisation, and `spya-z6c3dr` says out loud *"we're getting a little bit ahead of the story"*. A
run with a high conflict count on that piece may be the mode working; a high count on a plainly
linear article is the mode failing. Without the counter we would not be able to tell the difference,
and with no sort to protect, the counter is four lines.

## Nothing is dated unless the article dates it

Still the rule the mode lives or dies by. **The mechanism changed completely**, because the first
one did not work — see
[§ What the review and the spike found](#what-the-review-and-the-spike-found-2026-08-31) for the two
proofs.

The first design asked the model for a date plus the words it came from, then checked the words were
in the block. That check both **rejected correct dates** (an editorial `[F]rom` bracket) and
**accepted wrong ones** (`findQuote` is substring matching, so `July 1` is found inside `July 11`,
and four of this article's blocks hold two dates each).

**The rule now is structural rather than checked.** Code parses the block's own characters, so a date
the article does not contain has no way into the artefact. There is nothing to validate, because
there is nothing to distrust: the model never handed us a date.

What is still validated, exactly as `src/ideas.ts` does it:

- **the occurrence** — block id must exist in `blocks.json`, quote must be locatable by `findQuote`;
- **the phrase's location** — the parser must find the temporal expression inside the occurrence, and
  records where. A phrase we cannot locate means no date, not a guessed one.

### Three outcomes, not two

The review's point, and it holds: a rejected date must not render identically to a genuine absence.

| | The row shows |
|---|---|
| occurrence invalid | the event is dropped |
| occurrence valid, date parsed | the date, with its marks |
| occurrence valid, date evidence rejected | the event, and **"this piece dates this, and we could not read the date"** |

The third is the one the first design got wrong: it demoted silently to an ordinary undated row, so
"fails visibly" was only true inside a counter.

Counters, in the shape of `Dropped` in `src/ideas.ts` — counts only, never prose, never quotes, never
the raw parse error: `unknownIds`, `unquoted`, `unparseablePhrase`, `phraseNotInOccurrence`,
`noYearFrame`, `orderConflicts`, `overCap`, `malformed`.

## The marks: two brackets and what sits between them

Greg picked "show it in the drawing itself". The notation is **compositional** rather than six
symbols to memorise — three slots, each meaning one thing, read left to right.

**It got simpler when `basis` was cut.** The first draft used a filled dot for a date the article
stated and a hollow one for a date we worked out. With the parser reading the article's own
characters, *every* date is the article's, so the distinction had nothing left to mark — and since
the year is filled in on every row of a piece like this one, a "we touched this" mark would be on
every row and say nothing.

So the dot is just a dot, and **the brackets carry all of it**:

```
   ┌──────────── is there a bound on the EARLIER side?
   │   ┌──────── the event
   │   │   ┌──── is there a bound on the LATER side?
   │   │   │
   │   ●   │        26 May          the article gives a date
   ⋯   ●   │        by 12 May       at or before this, and no earlier bound
   │   ●   ⋯        after 12 Jul    at or after this, and no later bound
   ⋯   ●   ⋯        —               no date; this row is placed by the story alone
   │ ▬▬▬▬▬ │        13–19 Jul       the event LASTS this long
   │   ⊘   │        —               the piece dates this and we could not read it
```

- **`│` bound** — the article gives this edge.
- **`⋯` open** — no bound on this side at all.
- **`▬▬▬` bar** — `extent: "extended"`. The event fills the interval rather than sitting inside it.
  Fixed width, because Greg chose the un-scaled list; the duration is said in words beside the date.
- **`⊘`** — the third outcome from
  [§ Three outcomes](#three-outcomes-not-two). Rare, and it must not look like an ordinary blank.

Five marks on one axis, and each is a composition rather than a symbol. The legend sits at the foot
of the panel and shows exactly these lines.

**A relative expression has no marks and no interval.** "Another month later" sits in the date column
as the article's own words. That is honest — we know where it goes in the sequence and nothing more —
and it needs no notation to say so.

`modality` is not in this notation. A prediction is not a kind of doubt about a date, so it gets a
divider and a heading rather than a glyph.

### Accessibility is not the legend

Raised by the review, and it is right: a panel whose meaning is carried by typographic glyphs is
unreadable to a screen reader and fragile across fonts.

- Every glyph is `aria-hidden`. Each row carries a complete spoken sentence — *"at or before 12 May;
  year taken from the publication date"* — not a symbol name.
- The marks are drawn as CSS or inline SVG rather than Unicode characters, so they do not depend on
  what the reader has installed.
- Both themes, and the selected and focused states, checked in a browser rather than asserted.

### What the panel looks like

```
  TIMELINE MODE — same spine, same article, the band is an ordered list

 ┌─────────────┬─────────────────────────────┬──────────────────────────┬───┐
 │             │  Mode: timeline                                        │   │
 │  ▇▇▇▇▇▇▇▇   ├─────────────────────────────┼──────────────────────────┤ ▍ │
 │  ▇▇▇▇▇      │ 🕘 Timeline           19     │  … during May, OpenAI    │   │
 │  ▇▇▇        ├─────────────────────────────┤    was training a model  │   │
 │  ▇▇▇▇▇▇▇    │ │▬▬▬▬│  May 2026    31 days │    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓    │ ▍ │
 │  ▇▇         │         OpenAI trains the   │  ┃ that the agents ran   │   │
 │  ▇▇▇▇       │         model the agents    │    inside …              │   │
 │  ▇▇▇        │         run inside          │                          │   │
 │  ▇▇▇▇▇      │                             │      ↑ the wash and the  │ ▍ │
 │  ▇▇         │ ⋯  ○  │  by 12 May          │        ┃ rule — the SAME │   │
 │  ▇▇▇▇▇▇     │         Agents work out how │        marks a search    │   │
 │             │         to talk to each     │        hit draws         │   │
 │             │         other               │                          │   │
 │             │                             │                          │   │
 │             │ │  ●  │  26 May             │                          │   │
 │             │         They exploit a      │                          │   │
 │             │         vulnerability       │                          │   │
 │             │         ┌──────────────────┐│                          │   │
 │             │         │THE ARTICLE SAYS  ││                          │   │
 │             │         │┃"Two weeks later,││                          │   │
 │             │         │┃ on May 26, the  ││                          │   │
 │             │         │┃ agents success… ││                          │   │
 │             │         ├──────────────────┤│                          │   │
 │             │         │WHERE IT IS  ‹1/2›││                          │   │
 │             │         └──────────────────┘│                          │   │
 │             │                             │                          │   │
 │             │ ┊  ○  ┊  ~26 Jun            │                          │   │
 │             │         A second exploit is │                          │   │
 │             │         found               │                          │   │
 │             │         worked out from 26  │                          │   │
 │             │         May + "another      │                          │   │
 │             │         month later"        │                          │   │
 │             │                             │                          │   │
 │             │ ⋯  ○  ⋯  order only         │                          │   │
 │             │         The package manager │                          │   │
 │             │         crashes             │                          │   │
 │             │                             │                          │   │
 │             │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │                          │   │
 │             │ WHAT THE PIECE EXPECTS   2  │                          │   │
 │             │                             │                          │   │
 │             │ ┊  ○  ⋯  next six months    │                          │   │
 │             │         Rapid capability    │                          │   │
 │             │         advances continue   │                          │   │
 │             ├─────────────────────────────┤                          │   │
 │             │ │● stated  ○ ours  ┊ soft   │                          │   │
 │             │ │⋯ open    ▬ it lasts       │                          │   │
 ├─────────────┴─────────────────────────────┴──────────────────────────┴───┤
 │ ⊞Hierarchy ▤Summary 📖Glossary 💡Ideas 🕘Timeline ● 🔍Search ⌸Chat  …      │
 └──────────────────────────────────────────────────────────────────────────┘

 The dotted rule and the heading are where `modality` stops being "happened".
 Predictions sort to the end anyway, so the boundary costs no reordering — it
 just refuses to let the reader's eye run from a date into a forecast.

 A selected row expands, the same way an Ideas entry does, and reuses the same
 two sub-panels: the article's own words, and the ‹ › stepper over the blocks
 that mention it. The date's provenance is one line of plain text under the
 label — only on the row that is open, and only when the basis is not "stated".
```

---

*(sections below filled in from the repo survey — the files, the stage, the prompt, the stages of
work, and the questions for Greg)*

---

## The prompt

Full text in the implementation. The parts that are decisions rather than wording.

**The dating rule**, which is the whole feature and goes first, before the format, before the
examples:

> Never write a date the article does not support. Leaving an event undated is a CORRECT answer and
> is often the right one. Every date you give must come with `phrase` — the article's own words you
> read it out of, copied exactly — and a date whose phrase is not in the text will be thrown away.

**The "by" rule**, because five of the twenty-four expressions on the test article are this and a
model will flatten every one of them:

> "by July 4" does not mean July 4. It means *at or before* July 4. "after July 12" means at or
> after. **"not until July 13" is a LOWER bound, not an upper one** — it says the thing had not
> happened yet, so it happened at or after the 13th. These are bounds, and you must not turn a bound
> into a point, or flip one.

**The extent rule** — the one judgement still asked of the model, and the spike says it is good at
it (correct on both showcase rows in both runs, never flipped):

> Two different things make an interval wide. "From July 13 through July 19" is an event that LASTS
> six days — `extended`. "At some point on July 12" is an event that took a moment, and we do not know
> which moment — `instant`, with the interval one day wide. Ask yourself: was the thing still
> happening in the middle of the interval? If yes, `extended`.

**The no-dates rule**, which replaced the arithmetic ban when
[the parser took over](#the-model-supplies-evidence-code-supplies-dates) and is now the first thing
the prompt says:

> Do not give dates at all. Give the article's own words — "By the next morning, July 11" — copied
> from the paragraph, and stop. We read the date out of them ourselves. If the article does not put a
> time on something, say so; an undated event is a correct answer and often the right one.

The spike is why this is safe rather than hopeful: asked to withhold arithmetic, the model withheld
it completely — nine relative structures per run, zero computed dates.

**The article-is-hedging rule**, which is row 16 and is the thing no other mode notices:

> When the article hedges about its own timing — "at some point", "seem to show", "we think", "roughly"
> — that hedge is part of the answer. Widen the interval and set `basis` accordingly. Do not report
> the author's uncertainty as your own certainty.

**The label rule**, which is [the awkward thing](#say-the-awkward-thing-first) made into an
instruction:

> `label` is a handle, not a retelling — under about ten words, enough to recognise the event you
> already read about. Never write a label a reader could substitute for the paragraph.

### Negative examples

The Ideas stage learned that a ban relocates a register rather than deleting it, and that one negative
example is not enough when a feature has several failure modes. This one has five, and each gets a
worked bad/good pair in the prompt:

1. **The flattened bound** — "by July 4" returned as a point on July 4.
2. **The confident guess** — a year, a month or a day supplied from world knowledge, with a `phrase`
   that gestures at the paragraph rather than containing the date. The one that will look most right.
3. **The retelling label** — a label that is a sentence of summary, which is where the "don't
   summarise" ban will relocate to once the labels are capped.
4. **The topic on a line** — "the rise of the agents" as an event. A theme with a date stapled on,
   the direct analogue of the Ideas stage's worst output.
5. **The prediction filed as history** — "advances continue over the next six months" with
   `modality: "happened"`, which is the failure that makes the panel dishonest rather than merely
   wrong.

And the register to expect the bans to relocate into, so the first run can be checked against a
prediction rather than a vibe: dates migrating out of `when` and into `label` as prose ("in May, …");
`phrase` filled with a nearby sentence that does not contain the date; every hedge collapsing to
`basis: "inferred"` because it is the easiest field to reach for; and the piece's own dates (row 20,
"a couple weeks ago, I interviewed…") coming back as events despite being excluded, because they are
the most clearly-dated sentences in the article.

**Parse and salvage per event**, so one malformed row does not take the other eighteen with it.

### What the model is shown

The skeleton before the full text, in the order `arc`, `glossary` and `ideas` already use — plus one
thing they do not need: **the publication date, named as the reference frame**, and an explicit line
saying what to do when there is not one.


---

## Freshness, and the empty case

**The freshness input is blocks AND tree AND the publication date** — `datedArticleFingerprint` in
[`src/source-hash.ts`](../../src/source-hash.ts), **not** the `articleFingerprint` the other stages
use, and `meta` is load-bearing here rather than defensive: the publication date is the
reference frame for nineteen of the twenty-four expressions on the test article, so a change to it
changes almost every row. This is the first stage where the metadata's presence in the hash is
obviously right rather than a hole being closed.

The profile does **not** go in the stamp. Who is reading changes what an *idea* is — "what you need to
bring" is defined by the reader — but it does not change when something happened. Leaving it out is a
decision, not an omission, and it means one fewer reason to regenerate.

### Why Timeline gets its own fingerprint, and does not widen the shared one

**Corrected during Stage 0, against this plan's own instruction**, and the implementer was right to
push back.

The obvious move is to add `publishedAt` to `MetaFingerprint`, which `arc`, `tweets`, `glossary`,
`summary` and `quotes` are all judged on. It would have fired immediately rather than theoretically:
the date arrives **by re-extraction**, so the first article re-extracted — which Stage 0 itself does
— marks all five of those artefacts stale and re-runs five paid stages over bytes **no model ever
saw**. Not one of their prompts prints a publication date.

[`src/source-hash.ts`](../../src/source-hash.ts) already says as much in its own comments, and
already has the precedent: `MetaFingerprintWithUrl` exists as a **separate type** rather than as a
widened `MetaFingerprint`, for exactly this reason.

So Timeline gets `MetaFingerprintDated` / `datedArticleFingerprint`, which satisfies the review's
point better than the instruction would have: **the date is in the hash of the stage that names it,
and no other.**

**What made it a trap rather than a preference:** `MetaFingerprint` feeds `arc`, `tweets`, `glossary`,
`summary` and `quotes` directly, and `ideas` and `sketch` through `MetaFingerprintWithUrl`, which is
built on it — so a fourth element in that array moves the head for seven stages at once. On today's
corpus the change is **invisible while the field is absent**, which is exactly what makes it
dangerous: it detonates on the *first re-extraction*, one article at a time, silently, months later.
Stage 0 reproduced it directly — mutating the code to widen `MetaFingerprint` reddens the isolation
test and nothing else — which is what turns "this would have been expensive" from an argument into
evidence. No existing pinned hash changed.

Three smaller corrections from the same pass:

- `MetaFingerprint` carries title, byline and **siteName**. The url is on `MetaFingerprintWithUrl`.
  This plan said otherwise.
- The bundled `@mozilla/readability` types **do** expose `publishedTime`. No cast, no workaround.
- **The publisher's own timezone is kept rather than normalised to UTC.** `new Date(s).toISOString()`
  looks like the obvious tidy-up and it moves the calendar day — 8pm on 31 December in New York
  becomes 1 January — and the calendar day is the entire point of this field.

### There is no publication date until stage 2 is taught to keep one

Found by ingesting the test article rather than by reading the types. `Meta` carried
`{ slug, title, byline, siteName, lang, url, fetchedAt, excerpt }` and nothing else. `fetchedAt` is
when **we** downloaded it — two days after publication on this article, and potentially fifteen years
after on an older one — so it is not a fallback, it is the wrong number wearing the right shape.

The date was in the page all along: Readability returns
`publishedTime: "2026-08-29T22:47:53+00:00"` and `src/extract.ts` dropped it on the floor.

**Every article ingested before 2026-08-31 has no `publishedAt`, and never will unless it is
re-extracted.** So the no-frame path is not an edge case handled for completeness — it is the path
most of the corpus takes, and it must be the well-tested one. On such an article every year-less date
stays year-less and the row falls back to `order`, which is a correct answer and a much less useful
one.

### `Meta` growing a field is gated by two tests nobody knew were the gate

Found in Stage 0, by tripping it. The moment `publishedAt` reached
`data/openai-huggingface/meta.json`, two shared tests went red:

```
tests/store-roundtrip.test.ts > preserves meta.json exactly
tests/store-parity.test.ts    > returns an identical Article
-   "publishedAt": "2026-08-29T22:47:53+00:00",
```

Both push `meta.json` through Postgres and compare. There is no `published_at` column, so the field
comes back missing. **Nothing is wrong with the code** — `META_COLUMNS` in
[`src/store/artifacts-pg.ts`](../../src/store/artifacts-pg.ts) enumerates stage 2's fields
explicitly, and its own comment says *"a stage that grows a field must be made to decide where it
goes"*. It did exactly that.

**These two tests are the only thing in the repo that enumerates `Meta`'s keys against the store's
columns.** Nothing else would have caught it, and it is worth knowing that they are load-bearing in a
way their names do not advertise.

So **Stage 4 must add**: the `published_at` column on `article_revisions`, the entry in
`META_COLUMNS` and `metaColumns()`, the read in `readMeta`, `pg-revisions.ts`'s carry map,
`export.ts`, and the migration. Until then the field cannot survive a round trip.

**The date is parked, not shipped.** `data/` is gitignored, so the red existed only on this machine —
but five sessions share this checkout and several run `npm test`, and two reds from an artefact this
work created would land in everyone's gate with nothing to say they were not theirs. The line is
removed from `meta.json`; the code and its fourteen tests stand; `npm run extract` puts it back in
seconds when Stage 2 needs it. The plan's Stage 0 done-criterion and a green tree are incompatible
until Stage 4, which is the same shape as the deliberate red from
[`tests/db-step-constraint.test.ts`](#the-migration-is-not-optional-and-drizzle-will-not-write-it).

### Fingerprint the real `null`, not the prompt's stub

A trap that has already bitten `ideas` and `sketch`, and which Timeline is **more** exposed to than
either, because an article with no metadata is not an edge case here — it is every article ingested
before 2026-08-31, since the publication date only arrives on re-extraction.

When there is no metadata, a stage that cites block ids builds a stub — `{ title: tree.slug }` — for
the **prompt**, because `articleWithIds` needs a head to write its `TITLE:` line. It must then
fingerprint the **real `null`**, not the stub.

Hash the stub and you write a fingerprint the `stamp` can never reproduce, because `stamp` reads the
real article and sees `null`. Every article without metadata then reports the stage stale **for
ever**, on every run, with nothing red anywhere and nothing to look at.
[`src/source-hash.ts`](../../src/source-hash.ts) § `articleWithIdsFingerprint` and
`fallbackHeadTitle`; `tests/meta-fallback-fingerprint.test.ts` pins the property.

**The caution attached to it is worth more than the rule.** The session that found this applied the
mutation — hash the stub instead of the `null` — and **nothing went red**. The two produce an
identical hash *today*, because `articleWithIdsFingerprint` resolves `fallbackHeadTitle` itself and
the stub carries that one field and nothing else. The rule protects the day that stops being true.

So a green suite is not evidence of getting this right; the only check is reading the call and seeing
which value was passed. That is
[silent-success.md](../reusable/silent-success.md) with a case where **even the mutation test agrees
with the bug** — sharper than any example currently in that doc.

### `stamp` and `run` read the article through different helpers

Settled by the session that owns [`src/article-input.ts`](../../src/article-input.ts), and it is a
deliberate asymmetry rather than an inconsistency:

- **`run` takes `readArticle`**, which refuses. A stage cannot proceed without an article.
- **`stamp` takes `tryReadArticle`**, which answers `null`. `stamp` asks *what stamp would this step
  write if it ran right now*, and an unreadable article there means **we cannot tell** — which
  `stepIsDone` turns into "not current, so re-run". That is the safe way to be wrong. A throw is a
  failed job.

Both share a body, so the stamp and the run read the same three coordinates: blocks and tree from
`toc`, metadata from `extract`.

### Most articles are not chronological

This is the mode that will most often have nothing to say, and it must say so plainly rather than
padding. An essay about a concept may contain two dates, both incidental.

- **Zero events** — the panel says the piece has no chronology in it, and offers nothing else. Not an
  error, not a retry button.
- **One or two events** — shown, with a line saying this piece is not really telling a story in time.
  Two rows under a "Timeline" heading, presented as a timeline, would be the panel overclaiming.
- **The button** is still in the bar on every article, on the `button-on-demand` rule the other modes
  use. The reader finding out that a piece has no chronology is a real answer.

The threshold is a constant with the reasoning next to it, not a magic number inline.

---

## What this deliberately does not do

- **No time-to-scale axis.** Greg chose the flat list. The axis is the obvious v2 and the data model
  supports it — intervals with real bounds are exactly what an axis needs — but it is not this piece
  of work.
- **No spine painting.** Search paints its hits into the spine and Ideas draws a rail; a timeline
  could mark where in the document each event is mentioned. It is a good idea and it is a second
  feature. Left out so that the first version is one thing.
- **No cross-article timeline.** Merging the chronologies of everything on the shelf is a different
  product.
- **No "told order" toggle.** A `?order=told|time` parameter showing the events in the order the
  article mentions them is cheap and tempting. Left out because document order is what the article
  already is, and the reader has it open beside the panel.
- **No editing.** The reader cannot correct a date. Comments exist for saying the thing is wrong.
- **No BCE dates, no times of day in the data model.** The interval is to the day. "The morning of
  July 10" narrows nothing we store — it is carried in `phrase`, shown to the reader, and does its
  ordering work through `order`. Storing times would mean parsing them, and the test article's
  sub-day expressions are all relative anyway.

---

## The traps this will walk into

Written down now so the review can add to them and the build can be checked against them.

1. **The model computes the arithmetic anyway**, ignoring the ban, and returns a plausible date with a
   `phrase` that contains "two weeks later" but not the date. The phrase check catches this only if it
   requires the *date* to be locatable, not merely the phrase — so the check is on the phrase
   containing the temporal expression, and an event that supplied both a relative structure and an
   absolute date has the absolute one recomputed from ours and the disagreement counted.
2. **`findQuote` and the article's own dashes.** The test article writes "July 13 through July 19";
   an em dash, a non-breaking space or a curly apostrophe between the model's copy and the article's
   text is the classic reason a quote that is plainly there cannot be found. `quote-match.ts` already
   handles some normalisation — the build must check *which*, and not assume.
3. **A date is not a `Date`.** Anything that goes through the platform `Date` constructor picks up a
   timezone, and a day can move by one across the server/client line. The interval is an ISO **string**
   end to end, compared as a string, and it never becomes a `Date` object.
4. **Partial ISO strings.** "2026-05" is a legal thing to want and an illegal `Date`. Either the
   interval is always a full day-precision string with the granularity carried separately, or the
   comparison function handles short forms. Pick one, in the types, before either side is written.
5. **The year-inference boundary.** A piece published on 3 January mentioning "December" means last
   December — **pick, do not widen.** An earlier draft of this plan said both, in two places, and the
   implementer followed the widening one and produced `2025-12-05 .. 2026-12-05`: a year-wide
   interval for something almost certainly last December, and a row with no sensible date to print.
   Since [dates no longer sort anything](#ordering-the-models-reading-and-the-dates-as-a-check-on-it),
   a wrong pick costs a wrong label rather than a wrong order, which makes picking much cheaper than
   it looked. The parser takes a **direction hint** so a prediction resolves forwards instead —
   without it, "in December we expect…" in a January piece resolves to last December, backwards.
6. **Ids must survive a re-run**, or a reader's link to an event dies on the next re-extraction —
   and **inheriting by label, which is what `ideas` does, will not work here.** Measured: the spike
   reran the same prompt on the same article and the labels paraphrased every time ("Message volume
   crashes package manager" became "Agents crash the package manager"). Sol reached the same
   conclusion from the other direction. Inherit on the **cited block set plus the date** — the two
   things that were actually validated — and mint a new id where that is ambiguous.
7. **The legend is a picture made of characters.** Five marks at small sizes in a proportional font,
   in both themes, is a rendering problem and not a design one. It gets looked at in a browser, not
   asserted in a test.
8. **The empty state is the common case** and will be the least-tested path.


---

## The files

Surveyed from `ideas` (stage 5f, 2026-08-27) and `sketch` (2026-08-30), the two most recent additions
of this exact shape.

### New

| File | What it is |
|---|---|
| `src/timeline-time.ts` | the arithmetic: intervals, year inference, relative resolution, ordering. **No model call, no I/O.** |
| `src/timeline.ts` | the stage — the prompt, the call, the validation, the CLI |
| `drizzle/0033_timeline.sql` | one `jsonb` column, and the `revision_step_runs_step` CHECK re-added by hand |
| `src/web/TimelinePanel.tsx` | the panel |
| `src/web/useTimeline.ts` | fetch + staleness + regenerate, over the shared `useStepJob` |
| `preview-timeline.html` + `src/web/preview-timeline.tsx` | the panel on a throwaway page, against a fixture |
| `docs/project/timeline.md` | the mode's owned doc |
| `tests/timeline-time.test.ts` | the pure functions — **the biggest test file of the three** |
| `tests/timeline.test.ts` | the stage: prompt shape, parsing, validation, the counters |
| `tests/timeline-resolve.test.ts` | the client, in jsdom (needs the `// @vitest-environment jsdom` pragma — without it the file silently gets no DOM) |

### Changed — the server

Surveyed file by file rather than guessed. **Six of these are exhaustive `Record` types, so the
compiler names them for you**; three are `Partial` and will be silently skipped if forgotten, which
is where to be careful.

| File | What changes | Enforced by |
|---|---|---|
| `src/types.ts` | the `Timeline*` types; `"timeline"` into `StepName` | — |
| `src/pipeline.ts` | imports, `STEP_ORDER`, `FORCE_ONLY_WHEN_NAMED`, the `LEGACY_UNCONVERTED_STEPS` decision, and the `STEPS.timeline` entry | **compiler** — `STEPS` is `{ [K in StepName]: PipelineStep<K> }` |
| `src/models.ts` | `ArticleStage` + `STAGE_EFFORT` + `ARTICLE_RENDERER`; `Task` + `TASK_TIER` + `TASK_WIRE` + `MODEL_ENV_VAR` | **compiler** — five exhaustive `Record`s |
| `src/jobs.ts` | `STEP_BUDGET_MS.timeline` | **compiler** |
| `src/store/artifacts.ts` | `ArtifactKind`, `ArtifactMap`, `SHAPE` | **compiler** for these three |
| `src/store/artifacts.ts` | `BASELINE`, `STAMP_SOURCE` | ⚠️ **`Partial` — silent if forgotten** |
| `src/db/schema.ts` | the `timeline` jsonb column, and the CHECK's step list | — |
| `src/api.ts` | `loadTimeline` — the filesystem adapter |  |
| `src/store/pg.ts` | `loadTimeline`, the currency check, the column-selection tables | `tests/store-revision-columns.test.ts` |
| `src/store/index.ts` | re-export `loadTimeline` | |
| `src/store/import.ts`, `src/store/export.ts` | teach both about `timeline.json` | `tests/store-artefact-manifest.test.ts` |
| `src/routes.ts` | the route regex and the `GET /api/timeline/:slug` handler | |
| `package.json` | `"timeline": "tsx src/timeline.ts"` | `tests/paid-cli-ledger.test.ts` |

### Changed — the client

| File | What changes | Enforced by |
|---|---|---|
| `src/modes.ts` | one word in `MODES`, with the comment every other entry has | |
| `src/title-text.ts` | `MODE_LABEL` | **compiler** — `Record<Mode, string>` |
| `src/web/Dock.tsx` | one `MODES_UI` row + a lucide-react icon import, at the hand-picked position | |
| `src/web/visitor.ts` | the `ARTEFACT` and `COSTS` tables, and `visitorGap()` | ⚠️ **fails closed** — an unlisted mode silently becomes owners-only |
| `src/web/params.ts` | `?event=`, following `ideaParam` exactly (`parseAsBlockId`, `history: "replace"`) | |
| `src/web/App.tsx` | `TimelineBand` **and** `VisitorTimelineBand` — the two-band owner/visitor pattern | |
| `src/web/search-hits.ts` | `resolveTimelineEvent`, reusing `resolveOne`/`page()` | |
| `src/web/styles.css` | a `§ timeline mode` section at the end | |
| `docs/project/reading-view-overview.md` | one line under "The modes in the band" | `tests/doc-links.test.ts` |

### Changed — the tests that are tables

These are the ones a new stage or mode does not fail into automatically. Every one was found by
survey, not by running anything, so treat the list as a checklist rather than a promise.

| File | What to add |
|---|---|
| `tests/page-head.test.ts` | **a hardcoded `expect(MODES.length).toBe(9)`** — already stale: `quotes` landed on 2026-08-31 and made it 10, so Timeline makes it 11 |
| `tests/page-title.test.ts` | a hand-typed label record — fails with "was a mode added?" |
| `tests/visitor-gaps.test.ts` | what `timeline`'s visitor gap should be |
| `tests/store-artefact-manifest.test.ts` | `HOMES["timeline.json"]` — goes red the moment the file exists on disk |
| `tests/store-roundtrip.test.ts` | the `ARTEFACTS` list |
| `tests/store-parity.test.ts` | `["timeline", (r) => r.loadTimeline(slug)]` — otherwise the two adapters are never diffed |
| `tests/article-cache-group.test.ts` | an assertion about what `timeline` shares a cached prefix with |
| `tests/public-imports.test.ts` | `src/timeline.ts` into `WRITERS` — ⚠️ a *missing* row is a silent gap, not a red test |
| `tests/paid-cli-ledger.test.ts` | a row proving the CLI calls `loadEnvLocal()` before it spends money |
| `tests/db-step-constraint.test.ts` | nothing — it goes red on its own, which is the point |

### Three decisions this survey turned up that the design has to make

1. **Legacy or converted? — settled: converted, and born that way.** Overtaken by events on
   2026-08-31: another session is mid-flight converting **all seven** article-reading stages off
   `dir: string`, and [`src/article-input.ts`](../../src/article-input.ts) has landed. Timeline is
   the eighth stage of that exact shape, so it takes `article: Article` from the start and never
   appears in `LEGACY_UNCONVERTED_STEPS` at all.

   The reason is sharper than tidiness, and that file's header states it: a stage's `stamp` asked the
   **store** for blocks/tree/meta while the stage generated from **disk**. On a laptop those are the
   same bytes; through a job-scoped `/tmp` on a deployment they are not, and a stage that hashes one
   article and generates from another is *"a stale artefact reporting itself current for ever, with
   nothing about it looking wrong"*. Taking the article as an argument makes that unrepresentable
   rather than merely unlikely.
2. **`ARTICLE_RENDERER`: `"ids"` or `"text"`?** `ideas` and `sketch` send the ids-bearing article
   because the model must name block ids; `arc`, `tweets` and `glossary` send plain text. Timeline
   needs ids for its occurrences, so **`"ids"`** — which also means it can share a cached article
   prefix with `ideas` and `sketch` and not with the others.
   `tests/article-cache-group.test.ts` exists because that has been got wrong before, and the file's
   own comment says it was *measured rather than argued*.
3. **Is a timeline visible to a visitor?** `src/web/visitor.ts` fails closed, so doing nothing makes
   it owners-only. If it should be shareable, that is a `publicTimeline` mapper, a `PublicTimeline`
   type and a field allowlist in `tests/public-dto.test.ts` — a real chunk of extra work.
   **Recommendation: owners-only in v1**, stated rather than defaulted into.

### Who else is in these files right now

Checked on 2026-08-31: another session is mid-flight on
[finish-the-database-move.md](finish-the-database-move.md) stage 1a/1b, and has **uncommitted edits
in `src/pipeline.ts` (227/63), `src/ideas.ts`, `src/source-hash.ts`, `src/store/artifacts.ts` and
`src/store/import.ts`** — five of the files above, including the two the stage plumbing must touch.
`src/routes.ts`, `src/web/App.tsx`, `src/modes.ts` and `src/types.ts` were clear.

Two things follow. **`src/ideas.ts` is a moving target**, so anything copied from it must be re-read
at the moment of copying rather than taken from this plan — its fingerprint helper has already been
renamed to `articleWithIdsFingerprint` under a `MetaFingerprintWithUrl` since the survey that
produced § The prompt. And **the stage's plumbing lands last**, after the arithmetic and the panel,
so that the contended files are touched in the smallest possible window.

Commit by pathspec, name every file, never `git add -A`, and read `git diff HEAD -- <file>` before
committing a shared one — [version-control.md](../project/version-control.md).


### The migration is not optional and drizzle will not write it

`revision_step_runs` carries a CHECK listing every `StepName`. `drizzle-kit generate` diffs
`src/db/schema.ts`, knows nothing about a CHECK expression, and has now produced a migration missing
it **three times** — `'summary'`, `'assets'` in `0029`, `'sketch'` in `0031`. The failure is a job
dying with a `23514 check_violation` a long way from the cause.

`tests/db-step-constraint.test.ts` is the gate that makes there not be a fourth, and it reads the
migration files statically rather than asking a database — so it will go red the moment the STEPS
entry is added and stay red until the SQL is hand-written. **That red is the plan working**, and the
migration is copied from `0031_sketch.sql`, which is the correct shape.

**Running it is a separate question from writing it.** Writing the `.sql` is free. Applying it
anywhere — even locally — is Greg's call under [AGENTS.md](../../AGENTS.md), and against the remote
database it is his call every single time.

---

## The stages of work

**Recut 2026-08-31.** The review's sequencing point is taken: building the panel against a contract
the evidence has not validated is the mistake
[ideas-mode.md § Run the eval before building any of it](ideas-mode.md#run-the-eval-before-building-any-of-it)
already corrected once. The spike has now done that job — the extraction works, twice, and the
numbers are in
[§ What the review and the spike found](#what-the-review-and-the-spike-found-2026-08-31) — so the
contract can be frozen.

The remaining cut is set by **which files other sessions are holding**: everything doable in a file
nobody else has open comes first, and the plumbing that reaches into five contended files goes last
and goes fast.

### Stage 0 — the publication date

`publishedAt` on `Meta`, populated in `src/extract.ts`, and added explicitly to the metadata
fingerprint. **One line of extraction**, not a scraper: Readability already returns
`publishedTime: "2026-08-29T22:47:53+00:00"` and the stage simply drops it on the floor.

It is another stage's file, so it goes in as its own small, separately reviewable change with the
reasoning attached — the sanctioned way to talk to another stage is through the artefact it writes.

Done: the test article re-extracted and `data/openai-huggingface/meta.json` carrying the date; every
article ingested before today still has none, so **the no-frame path is the common one and gets the
tests**.

### Stage 1 — the parser, and nothing else ✅ done

`src/timeline-time.ts`: read a block's text and a temporal phrase, return a `When` or nothing. Plus
the trivial ordering function and the `orderConflicts` comparison. No model call, no I/O, no UI.

This is now the heart of the feature rather than a support library, because
[the model supplies evidence and code supplies dates](#the-model-supplies-evidence-code-supplies-dates).
Everything the review said about correctness lands here, red first.

Cases, from the article and from the review: `on July 7` · `By May 12` · `after July 12` ·
`During May` · `from July 13 through July 19` (**seven dates, not six**) · `at some point on July 12`
· `the night of July 8` · `2026-07-19` · `[F]rom July 13…` (editorial brackets) · a year-less date
with no frame · a year-less date that would land after publication · inclusive "through" vs exclusive
"before" vs "not until" · a phrase that is not in the block · a phrase that is in the block but not
in the occurrence · month-end and leap-day arithmetic · duplicate and invalid `order`.

**No `Date` objects anywhere.** ISO strings end to end, compared as strings, so a timezone cannot
move a day across the server/client line.

**Landed** as `f5d0867` + `6d4fa4b`: [`src/timeline-time.ts`](../../src/timeline-time.ts) and
[`tests/timeline-time.test.ts`](../../tests/timeline-time.test.ts), 69 tests.

The implementation inverted what this plan asked for, and the inversion is the reason it works. It
**never looks for the model's string**. It scans the *block* for date expressions, scans the phrase
for the same, and uses the phrase only to choose which of the block's own dates is meant — **by
parsed value, not by substring**. Both halves of the old failure die from that one change: `[F]rom`
never has to be reproduced by anybody, because the bracket sits between two of the block's own
tokens; and `July 1` cannot select `July 11`, because 07-01 ≠ 07-11.

Verified independently against the real article before it was accepted:

```
"July 1"      vs a block holding July 10 and July 11   ->  REFUSED
"on August 3" vs a block that does not contain it      ->  REFUSED
"from July 13 through July 19"  (the [F]rom row)       ->  2026-07-13 .. 2026-07-19 extended
"By May 12"   (block also holds May 26)                ->  — .. 2026-05-12
"on May 26"   (same block)                             ->  2026-05-26 .. 2026-05-26
"On July 7" with no publication date                   ->  REFUSED, rather than guessing a year
```

**Three contradictions in this plan came out of it**, all recorded above: "not until" is a lower
bound and the plan had it as an upper one; the prompt still asked the model for `extent` after the
data model gave it to the parser; and the year rule said *pick* in one place and *widen* in another.

**Twenty-four guards, broken one at a time. Two survived, and both were real gaps** — a cue reaching
across a date, and an exclusive lower bound on a *month*, where `shiftDay(end, +1)` and
`shiftDay(start, +1)` are indistinguishable at day precision and only a month-wide interval tells
them apart. Both have tests now.

The tests **pin thirteen of the article's blocks verbatim** — real ids, curly apostrophes, the
`[F]rom` bracket — so the cases are the article's own without the suite depending on gitignored
`data/`.

**Hand-off gap for Stage 2:** `direction` is unwired until `modality` is passed into it, and that is
a fault in the artefact rather than an unused parameter. Twenty-two of the article's expressions are
history and resolve correctly backwards; **two are forecasts and would resolve backwards too**,
dating a prediction before the piece was written.

### Stage 2 — the generator, in its own file

`src/timeline.ts`: the prompt, the call, the parsing, the occurrence validation, the counters, the
CLI. It writes `data/<slug>/timeline.json` and touches nothing else —
`npm run timeline -- data/openai-huggingface`, filesystem in, filesystem out. That is how every
stage's CLI already works, so it is the finished stage minus its wiring.

The prompt is the spike's, which is measured rather than hoped for. Done: run for real, counters
reported, output read by eye against the twenty-four expressions.

### Stage 3 — the panel

`TimelinePanel.tsx`, `useTimeline.ts`, `modes.ts`, `title-text.ts`, `Dock.tsx`, `visitor.ts`,
`params.ts`, `App.tsx`, `styles.css`, `search-hits.ts`, a preview page, and the three table-tests
that name every mode. Built against Stage 2's real artefact.

Two traps the survey already found: the preview page's wrapper needs `className="reader spine-on"`
**and** the custom properties `App.tsx` normally sets on `.reader`, or the band renders about three
times too wide; and every scrollable child of `.mode-band` needs
`flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain`.

Done: all five marks, the `⊘` state, the legend, the prediction divider, an expanded row, the empty
state and the two-event state — **looked at in a browser**, in both themes, in a subagent.

### Stage 4 — the plumbing, last and fast

`pipeline.ts`, `models.ts`, `jobs.ts`, `store/*`, `db/schema.ts`, the migration, `routes.ts`,
`api.ts`, and the table-tests in [§ Changed — the tests](#changed-the-tests-that-are-tables).
Mechanical and compiler-guided, done in one sitting against a freshly-read `src/ideas.ts`.

**Writing the migration is free; applying it is Greg's call**, locally as well as remotely.

### Reviews

Sol has reviewed the plan once and this is the revision answering it. The next review is on **code**,
at the end of Stage 2 — which the working agreement says to weight higher anyway, because a
plan-stage review reads prose and cannot find the bug that does not exist yet.

## Questions for Greg

Each has a recommendation so nothing is blocked on an answer.

### 1. Should the publication date appear as a divider?

You did not pick "the piece's own dates" as content, and this is not quite that. Everything the piece
*predicts* sorts after everything it *narrates*, and the line between them is, in fact, when the piece
was written. Drawing that boundary as `─── written here, 29 Aug 2026 ───` costs one row and tells the
reader what "next six months" is six months from.

**Recommendation:** yes, as a divider, never as an event — it has no mark, no label and cannot be
clicked. If it reads as clutter it comes out.

### 2. Does the panel follow the reader down the page?

The summaries panel tracks where you are in the prose. A timeline could highlight the event nearest
the paragraph you are reading, which would make the panel a second position indicator.

**Recommendation:** not in v1. The whole value of the panel is that it is in a *different* order from
the prose, so following the reader means the highlight jumps around the list unpredictably — which is
the correct behaviour and probably an unpleasant one. Worth trying once it exists, cheap to add.

### 3. What is on the button, and where does it go in the bar?

The bar's order is yours and runs from the article restated, through the ways into it, to the
conversation about it.

**Recommendation:** "Timeline", a clock icon, sitting **after Ideas and before Search** — it belongs
with Glossary and Ideas as a third "here is one dimension of this piece pulled out", and it is further
from the article's own words than either.

### 4. How few events before the panel stops calling itself a timeline?

**Recommendation:** three. One or two dated things is an article that mentions a date; three in
sequence is a chronology. Below the threshold the rows still show, under a line saying the piece is
not really telling a story in time.

### 5. What happens when two sentences describe the same event?

The test article recounts the same three months more than once, so this will happen on the very first
run. Merging risks losing a real distinction; not merging produces a list with visible duplicates.

**Recommendation:** do not merge in the artefact — one event, several occurrences, and the prompt is
told that the same happening mentioned twice is **one** event with two occurrences. If that fails in
practice, the fix is the prompt, not a similarity threshold in code.

---

---

## What the review and the spike found (2026-08-31)

GPT Sol reviewed this plan and returned **STOP — revise before Stage 1**
([timeline-mode-review-sol.md](timeline-mode-review-sol.md)). In parallel a spike ran the extraction
twice against the ingested article, for $0.37. Between them they settle most of what was guesswork
above. **Three of Sol's checkable claims were checked rather than believed** — two held, one did not.

### The phrase check does not work, and it fails in both directions

This was the plan's central safety claim. It is wrong as designed, and the two proofs are
independent.

**It rejects correct dates.** The one phrase-check failure in each spike run was the same row — the
one [§ One interval, two flags](#the-model-supplies-evidence-code-supplies-dates) holds up as the reason `extent` exists:

```
block spya-ebtbnm:  "[F]rom July 13 through July 19, agents set their sights on…"

findQuote(block, "from July 13 through July 19")   ->  null
findQuote(block, "July 13 through July 19")        ->  { start: 7, end: 30 }
```

An **editorial capitalisation bracket** in a quoted METR excerpt. The model normalised `[F]rom` to
`from`, which is what a person would do. `FOLD` in [`src/quote-match.ts`](../../src/quote-match.ts)
handles curly quotes, three dashes and non-breaking spaces; nothing handles brackets, and brackets
change the string's length so they cannot join `FOLD` as it is written. Under this plan's rule a
correct, stated, in-the-article date is silently demoted to undated.

[§ The traps](#the-traps-this-will-walk-into) item 2 named dashes and curly quotes as the hazard.
Both are already handled. **The trap list guessed the wrong trap**, which is the argument for running
the thing rather than reasoning about it.

**It accepts wrong dates.** `findQuote` is substring matching with no token boundary:

```
findQuote("By the next morning, July 11, …", "July 1")  ->  { start: 21, end: 27 }
findQuote("By May 12 … on May 26, they exploited it.", "May 2")  ->  matches
```

So `July 1` is "found" inside `July 11`. And **four of this article's blocks hold two distinct dates
each** — `spya-v9detz` (May 12, May 26), `spya-g9tjds` (June 26, July 4), `spya-sjjbur` (July 10,
July 11), `spya-ebtbnm` (July 13, July 19) — so a phrase naming the *wrong* event's date is found in
the right block and passes. Those four are the spine of the piece.

**A found phrase proves the phrase is in the paragraph. It never proved the date was right**, which
is what the check was for.

**The fix, from Sol, and it is the right one:** stop asking the model for an authoritative date at
all. Locate the temporal phrase in the occurrence, **parse it deterministically in code**, and
require every displayed component to come out of that parse. The model supplies evidence; the
compiler supplies dates. That also deletes `inferred` dates, which contradicted
[§ Nothing is dated](#nothing-is-dated-unless-the-article-dates-it) the moment they were allowed.

And validation failure must not render as an ordinary undated row — three outcomes, not two: evidence
bad → drop the event; evidence good → date it; date evidence rejected → keep the event and **say the
date was rejected**. Otherwise "fails visibly" is only true inside a counter.

### What the model actually did, twice

Much better than this plan assumed. Two runs, same prompt, same article.

| | Result |
|---|---|
| Coverage | 20/24 expressions run 1, 18/24 run 2 |
| Excluded rows (the piece's own dates) leaking in | **0 of 2, both runs** — the plan predicted these would leak |
| "by" bounds preserved rather than flattened | **11 of 12** |
| Lower bounds ("after July 12") | correct, unprompted |
| `extent` correct | **both showcase rows, both runs**; never flipped |
| Arithmetic ban obeyed | **completely** — 9 relative structures per run, 0 computed dates |
| Block ids real | 26/26 and 24/24, **zero invented** |
| Phrase contained its own date | 17/17 and 18/18 — volunteered, *not* enforced |
| Year | 2026 everywhere, correct |

So the two failures this plan was most shaped against — flattened bounds and invented block ids —
barely happened, and the arithmetic ban held perfectly. The design's caution was aimed at the wrong
places.

### Two runs, and what moved between them

The rest of the spike's numbers, because "it worked" is not a measurement.

Of 21 events matched across both runs: `extent` flipped **0/21**, block ids **0/21**, bounds
**1/21**, `basis` **12/21**. Event count was 25 then 23 — the four that vanished were all *undated
connective steps*, which run 2 folded into their neighbours.

**Labels paraphrased freely on every run.** That is the finding with a consequence: id inheritance by
label, which is how `ideas` does it, cannot work here. Inherit on the cited block set plus the date.

**One order-vs-dates conflict, and the model was right.** "By July 13, Hugging Face locked down the
credentials" against "After July 12, more evaluations were kicked off" — an upper bound against a
lower bound, which prove nothing about each other. So `countOrderConflicts` must only fire where the
intervals *prove* an order and never where either side is open. It is also the case that stops the
counter being vacuous: on this article the right answer is zero.

**One pass, not two.** Every field except `basis` was stable and correct in the same call, and the
one bad field would have been just as unstable alone — so a verifier pass costs $0.15 and buys
nothing. Size the answer budget at 20k tokens; the runs produced 12k and 19.6k.

**Known limitation, accepted:** with no granularity field, "During May" and a span stated as 1–31 May
are indistinguishable in the artefact. Both are `2026-05-01 .. 2026-05-31, extended`, which is what
they mean; what is lost is only that the article said it one way rather than the other, and `phrase`
still carries the article's actual words.

### `basis` is a coin toss, and that is the field to cut

Same prompt, same article: run 1 marked 16 year-completed dates `"stated"`, run 2 marked 13 of them
`"derived"`. It also puts `basis: "inferred"` on rows that carry **no date at all**, where the field
means nothing.

Sol names the cause: in "July 7" the month and day are **stated** and the year is **derived**, and
one field per event cannot say both. Three independent routes to the same place — the plan's own
argument, the review, and the model's behaviour.

### Smaller corrections

- **"July 13 through July 19" is seven calendar dates, not six.** This plan said six. The article's
  own "six-day sprint" is a different, unanchored duration (row 21).
- **Sol's claim that `tests/db-step-constraint.test.ts` is already red is wrong** — it passes, 4
  tests green. A peer landed a `quotes` stage and its migration while this was being written.
- **`publishedAt` is one line, not a scraper.** Readability already returns
  `publishedTime: "2026-08-29T22:47:53+00:00"`; [`src/extract.ts`](../../src/extract.ts) simply does
  not copy it into `meta`. And *saying* metadata is in the fingerprint does not put the publication
  date there — `MetaFingerprint` carries title, byline, site and url. It has to be added explicitly.
- **The model cannot return an event id it has not been given.** Raw output needs temporary local
  keys — the spike used `relative.toOrder` and it worked.
- **"a few hours" came back as `{ value: 3, unit: "hour" }`.** The 3 is invented. `approximate: true`
  records fuzziness, not that we made the magnitude up.
- **The honest framing**, from Sol, and it is better than the one at the top of this file: not *when
  did all this happen*, but ***when does the piece say these things happened*** — an
  evidence-navigation tool that is summary-shaped, earning its place by sending the reader back to
  the prose.

### The stage cut was wrong

Stages 2 and 3 are parallel by file ownership, which is true and beside the point: building the panel
against a contract the eval has not validated is the sequencing mistake
[ideas-mode.md § Run the eval before building any of it](ideas-mode.md#run-the-eval-before-building-any-of-it)
already corrected once. Eval first, then freeze the types, then the UI.


## See also

- [ideas-mode.md](ideas-mode.md) — the stage this is modelled on, and the source of the
  validate-every-id discipline.
- [ideas.md](../project/ideas.md) — and in particular
  [§ It is a hypothesis](../project/ideas.md#it-is-a-hypothesis-and-the-panel-says-so), which is the same worry about
  evidence-shaped output pointed at a different field.
- [glossary.md](../project/glossary.md#a-prompt-ban-relocates-a-register-it-does-not-delete-one) —
  a prompt ban relocates a register, it does not delete one.
- [outline-mode.md](outline-mode.md) — the most recent mode added, and the freshest account of what
  adding one costs.
- [silent-success.md](../reusable/silent-success.md) — the failure this mode is most exposed to: a
  run that produces confident dates and reports nothing wrong.
- [engineering-manager.md](../reusable/engineering-manager.md) — how this job is being run.
