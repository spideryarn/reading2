# Quotes mode — the lines worth keeping

Greg, 2026-08-31:

> Create a "Quotes" mode that extracts the most central, helpful, interesting quotes. By default,
> display them in order. But also have a sub-mode for ordering them by importance, and a sub-mode for
> ordering by how memorable/interesting/striking/lyrical/etc. And add a threshold UI bar, and a
> Prioritised mode. Take inspiration from the Glossary mode.

The tenth mode, stage 5h. The [glossary](../project/glossary.md) answers *what does this word mean*;
[ideas](../project/ideas.md) answers *what do I have to hold*. This one answers a third question,
and it is the only one of the three whose answer is **entirely in the author's own words**.

```
  QUOTES MODE — same spine, same article, the band is the author's own lines

 ┌─────────────┬───────────────────────┬────────────────────────────┬───┐
 │             │  Mode: quotes                                       │   │
 │  ▇▇▇▇▇▇▇▇   ├───────────────────────┼────────────────────────────┤ ▍ │
 │  ▇▇▇▇▇      │ ❝ Quotes      14      │  … and the most mundane    │   │
 │  ▇▇▇        │ order [prioritised]   │    boilerplate — the sort  │   │
 │  ▇▇▇▇▇▇▇    │   in order  important │    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓    │   │
 │  ▇▇         │   striking            │  ┃ of thing you'd have to  │ ▍ │
 │  ▇▇▇▇       ├───────────────────────┤    be able to write …      │   │
 │  ▇▇▇        │ bar 0·70 · 5 of 14    │                            │   │
 │  ▇▇▇▇▇      │ ────────●──────────   │      ↑ the wash and the    │   │
 │  ▇▇         ├───────────────────────┤        ┃ border — the SAME │ ▍ │
 │  ▇▇▇▇▇▇     │ WORTH KEEPING     5   │        marks a search hit  │   │
 │             ├───────────────────────┤        draws, because it   │   │
 │             │ ❝Writing is thinking; │        IS one              │   │
 │             │  there is no other    │                            │   │
 │             │  kind.❞               │                            │ ▍ │
 │             │        imp·91 str·88  │                            │   │
 │             │        ↗ spya-k3m9qt  │                            │   │
 │             │   └──── hovering the  │                            │   │
 │             │        row shows WHY  │                            │   │
 │             │        it was picked  │                            │   │
 │             │                       │                            │   │
 │             │ ❝A model that cannot  │                            │   │
 │             │  be surprised has     │                            │   │
 │             │  stopped reading.❞    │                            │   │
 │             │        imp·62 str·94  │                            │   │
 │             ├───────────────────────┤                            │   │
 │             │ THE REST          9   │                            │   │
 │             ├───────────────────────┤                            │   │
 │             │ ❝…❞                   │                            │   │
 │             ├───────────────────────┤                            │   │
 │             │ Find them again       │                            │   │
 ├─────────────┴───────────────────────┴────────────────────────────┴───┤
 │ ⊞Hierarchy ▤Summary 📖Glossary 💡Ideas ❝Quotes ● 🔍Search ⌸Chat  …     │
 └───────────────────────────────────────────────────────────────────────┘

 EVERY WORD IN THE LIST IS THE AUTHOR'S, except the two numbers, which are
 labelled as the model's judgment, and the reason, which is a tooltip. That
 is the whole shape of this mode and the reason it is the safest of the
 three: a quote we cannot find in the article verbatim is DROPPED, never
 shown, because showing it would put words in the author's mouth.
```

## What it is not

**It is not a summary.** [summaries.md](../project/summaries.md) already gives the article at
whichever length you ask for, in the model's words. This is the opposite operation: it gives you the
author's own sentences, chosen. Nothing here is generated prose.

**It is not a highlight reel that replaces reading.** [vision.md](../project/vision.md) is against
"trying to replace the words with quick and easy summaries". A list of the lines the piece turns on
is a way *into* the prose — every row jumps to where it sits — not a substitute for it. The
distinction that keeps it honest is that pressing a quote takes you to the paragraph it came from,
in the article, with the surrounding sentences intact.

## The one safety property

**A quote that cannot be found in the article, verbatim, is dropped.**

Every other stage that writes prose can be wrong about a judgment. This one can be wrong about *what
the author wrote*, which is a different and worse kind of wrong — a plausible paraphrase in quotation
marks, attributed to a real person, on a page next to the real text. That is the failure this whole
design is arranged around, and there is exactly one defence: `findQuote` in
[`src/quote-match.ts`](../../src/quote-match.ts), the same function `validateHits` (search) and
`validateOccurrences` (ideas) already use, run against every block of the article.

The drops are **counted and logged**, because an invented quote silently discarded looks identical to
a quote the model chose not to return — [silent-success.md](../reusable/silent-success.md).

## The model never names a block id

This is the glossary's rule rather than the ideas' rule, and the choice is deliberate.

`ideas` and `sketch` hand the model `articleWithIds` and let it name block ids, because an idea has
no text of its own to match on — it is a proposition, and the only way back to the page is an id.
A quote *is* text. So:

```
   the model returns    →  the exact words, and nothing else
   we find              →  which block they are in, with findQuote over every block
```

Three things fall out of that, and all three are worth having:

1. **The model cannot invent a location**, the way it can invent a block id — the whole
   `dropped.unknownIds` class does not exist here.
2. **A misattributed quote is repaired rather than dropped.** If the model quotes correctly but would
   have named the wrong block, searching every block finds it anyway.
3. **The prompt sends `articleText`, not `articleWithIds`**, so this stage can share a cached article
   prefix with the four stages that already send those bytes — see § Effort and the cache.

## Two scores, and why they are combined with `max` rather than `×`

Every quote may carry `importance` and `striking`, 0–1, the model's own judgment:

| field | the question |
|---|---|
| `importance` | how much of the article's argument rests on this line |
| `striking` | how memorable, quotable, well-put it is — the line you would repeat |

The glossary **multiplies** its two scores, and the argument for that is specific to what those two
scores mean: `difficulty × centrality` is the *cost of not knowing a term*, and a term that is easy,
or peripheral, has no such cost. Two factors of one quantity.

**These two are not factors of one quantity. They are two separate reasons to keep a line**, and a
product gets that exactly backwards — it would push the essay's thesis sentence below the fold for
being plainly written, and drop the line you would tattoo on your arm for being an aside. Greg chose
`max` on 2026-08-31, from three options drawn out at the size the difference is visible:

```
                    striking
                 1.0 ┌──────────────┬──────────────┐
                     │              │              │
                     │  PROMOTED    │  PROMOTED    │
                     │  (the        │  (both)      │
                     │   beautiful  │              │
                     │   aside)     │              │
                 0.5 ├──────────────┼──────────────┤
                     │              │              │
                     │              │  PROMOTED    │
                     │  the rest    │  (the thesis │
                     │              │   sentence)  │
                 0.0 └──────────────┴──────────────┘
                    0.0            0.5            1.0
                                            important
```

> what this gets right: a line can earn its place for ONE good reason. The sentence the whole essay
> turns on is promoted even if it is drily written; the line you would tattoo on your arm is promoted
> even if the argument would survive without it.
>
> — the option Greg picked, 2026-08-31

**A missing score is skipped, not treated as zero, and with `max` that is safe in a way it is not
with `×`.** `priorityOf` takes the maximum over whichever of the two scores is present, and is
`undefined` only when neither is. A maximum over a subset can only be **lower** than the maximum over
both — so using one score can under-promote a quote and can never over-promote one, which is the
direction an honest default has to fail in. (Under a product, a missing factor is fatal rather than
conservative, which is why the glossary drops those entries to the lower group instead.)

### The bar starts at 0.70, not 0.30

`PROMOTE_BAR = 0.70`, where the glossary's `PRIORITY_GATE` is `0.30`, and the difference is not taste:
**a product of two 0–1 scores clusters low and a maximum clusters high.** Two scores of 0.7 make 0.49
under a product and 0.70 under a maximum. A bar copied across from the glossary would promote nearly
every quote and the divider would say nothing.

It is a guess with a slider under it, exactly as `0.30` is — see § The bar.

## What an entry holds

```ts
interface Quote {
  /** `mintUniqueId`, so it is block-id shaped and `?quote=` validates for free. */
  id: string;
  /** The block the words were found in — OURS, from findQuote, never the model's. */
  blockId: BlockId;
  /** The exact words. Verified against block.text before this object exists. */
  text: string;
  /** Where they sat in `block.text` — a disambiguator between repeats, never the anchor. */
  start?: number;
  /** One line on why this one. Shown as a TOOLTIP, never as body text — see below. */
  reason?: string;
  /** 0–1, the model's judgment, or absent. */
  importance?: number;
  striking?: number;
}
```

### The reason is a tooltip

Greg, 2026-08-31, answering what should sit under each quote besides the quote itself:

> with reason as a tooltip

So the row is the author's words and two labelled numbers, and the model's line on *why this one* is
reached by hovering or focusing the row. That is a stronger version of the answer the glossary
arrived at the hard way. The glossary's `senseHere` failed by filling with **descriptions of the page
the reader is looking at** — *"Quoted for the line …", "Used as an example of …"* — and that register
is not merely tempting here, it is the *default* register for the question "why this quote", because
the honest answer often really is a fact about the page. Putting it in a tooltip means:

- the list a reader scans is **entirely the author's prose**, which is the thing that makes this mode
  worth having at all;
- the model's contribution is **asked for**, one hover or one Tab away, rather than pushed;
- when the model does write *"the claim the rest of the essay defends"*, it is a caption on a row
  rather than a paragraph competing with the sentence above it in an 18rem band.

[`Tooltip.tsx`](../../src/web/Tooltip.tsx) and not a `title=` attribute, for the reason
[tooltips.md](../project/tooltips.md) already gives: `title=` does not open on keyboard focus, and a
tooltip that is the only route to a piece of content must.

**The prompt still bans the describes-the-page register**, because relocating it is not deleting it —
[glossary.md § A prompt ban relocates a register](../project/glossary.md#a-prompt-ban-relocates-a-register-it-does-not-delete-one).
What `reason` is for is what the *reader* could not work out from the line itself: which move in the
argument it is, or what makes the phrasing land. Absent is a real answer and the prompt says so.

## The orders, and the bar

Four orders, on `?rank=`:

| `?rank=` | label | what it does |
|---|---|---|
| `prioritised` | **prioritised** | two groups split by the bar; **first appearance inside each** |
| `document` | **in order** | first appearance. Greg's "by default, display them in order" |
| `importance` | **most important** | descending; unscored last |
| `striking` | **most striking** | descending; unscored last |

`prioritised` is the default, and `document` is one tap away — the same override of the same
condition the glossary made on 2026-08-26, and the same thing that keeps it honest: **inside a group
the order is first appearance**, so within a group the model has chosen nothing.

**The number a row shows is the number its position was decided on.** `rowScores` copies the
glossary's rule and its bug: in `document` order a row shows no numbers at all, because a list that
was not ranked must not print a ranking beside every row.

### The bar

`?bar=`, replace, debounced, **no default of its own** so that "absent" keeps meaning *nobody has
touched this*. Four properties carried straight over from the glossary's slider, and every one of
them is there because of something that went wrong:

- **the number and the count are both on screen** — `0·70 · 5 of 14` — because the count is what the
  reader is aiming at and the thumb position is not a number anybody can read;
- **the track ends where the data does** (`barMax`), rounded *down* to the step, so the right-hand
  end promotes exactly one quote rather than none;
- **it says when it has divided nothing** (`barNote`), because a slider whose two groups have merged
  looks exactly like a slider that has stopped working;
- **it can be put back** without the reader having to remember 0.70.

**It does not cancel itself when it fails to divide.** What falls back to `document` is an artefact
with no scores *at all* — nothing to bar under any setting — and then the control is not offered.
`effectiveRank`, copying `effectiveSort`.

## Selecting a quote

Pressing a row does what pressing an idea does: it marks the passage in the prose, paints a lane in
the rail, and jumps the article to it. `?quote=` carries it, `replace`, for the reason `?term=` and
`?idea=` replace.

The marks are **the same marks a search hit draws**, through the same `Found` shape — one
`resolveQuote` beside `resolveIdea` in [`search-hits.ts`](../../src/web/search-hits.ts), because a
quote is a `{blockId, text, start}` and that is what `resolveOne` already takes. A second way of
drawing a marked passage is a second thing to keep in step with the first.

**One quote at a time, and only while it is selected.** The prose never acquires marks on the model's
initiative — [vision.md § Principles](../project/vision.md#principles) — which is the same rule the
glossary's underlines and the ideas' washes follow.

**No `‹ 1/2 ›` stepper.** A quote is one passage in one block; there is nothing to step between.
That is the one piece of furniture the glossary and ideas panels have that this one does not need.

## The stage

`data/<slug>/quotes.json`, stage 5h, `quotes` in `STEP_ORDER` and **not** in `DEFAULT_INGEST_STEPS` —
everything after `arc` is a thing somebody asks for. In `FORCE_ONLY_WHEN_NAMED`, for the first of the
glossary's two reasons: it reads the blocks and the tree and nothing reads what it writes, so the
positional cascade would buy a model call for nothing. (The glossary's *second* reason — forcing
appends — does not apply, see below.)

```
npm run quotes -- data/<slug>
```

or `POST /api/jobs { "slug": "…", "steps": ["quotes"] }`, which is what the panel's button does.

### It replaces. It does not append.

The ideas' rule rather than the glossary's, and for the ideas' reason: a piece has a dozen quotable
lines, not an encyclopaedia of them, so there is nothing to paginate. Running the step again already
*is* "find them again". That deletes, at a stroke: the FORBIDDEN checklist, `existingFor`, "a stale
list is not appended to", the `passes` counter, the `DELETE` route, and the two-button `Find more` /
`Start again` footer. One verb.

**What it keeps is id inheritance.** `idsByText` gives a fresh quote the id the old artefact used for
the same words, keyed on a normalised form, so `?quote=` links survive a rewrite. Same as
`idsByName` in `src/ideas.ts`.

### Freshness

`stamp` in [`pipeline.ts`](../../src/pipeline.ts): `inputHash` (`articleFingerprint` — blocks, tree
and the metadata head, since the skeleton and the `TITLE:`/`BY:` head are both in the prompt),
`promptVersion`, `model`. **Not `profileHash`** — the profile changes *which* lines a reader is shown,
the way it changes which terms get an entry, but it does not change what the words are; that is the
glossary's position rather than the ideas'. `profileHash` is still recorded on the artefact and still
raises the "written for a you that has changed" banner.

### Effort and the cache

`STAGE_EFFORT.quotes = "medium"` and `ARTICLE_RENDERER.quotes = "text"`, which means **it shares a
cached article prefix with `glossary`** and with nothing else. That is a real saving — a reader who
opens both on one article is exactly the reader this mode is for — and it is a **constraint**: moving
either stage's effort breaks the share silently, the way the note on `sketch` says of `ideas`.

`medium` is also the setting the work wants, on the same argument the glossary's `medium` was
measured to satisfy: picking the sentence a piece turns on is a judgment about *this* text with the
text in front of it, not the multi-step inference `ideas` makes when it argues that a piece collapses
without an unstated premise. Untested, like every effort choice that has not been through
`evals/results/effort-vs-quality.md`, and said out loud here so the next person knows it is a guess
rather than a measurement.

### What the stage drops, and counts

```ts
interface Dropped {
  /** `findQuote` could not locate the words anywhere in the article. The important one. */
  unfound: number;
  /** Shorter than MIN_QUOTE_CHARS or longer than MAX_QUOTE_CHARS. */
  wrongLength: number;
  /** Resolved to a span overlapping one already kept. */
  overlapping: number;
  /** Quotes past MAX_QUOTES. */
  overCap: number;
  /** Not an object, or no text at all. */
  malformed: number;
}
```

`unfound` is the number to watch. A run that starts returning several is the model paraphrasing, and
paraphrase is the one failure this feature cannot be allowed to have. Nothing else would report it —
a dropped quote looks exactly like a quote the model chose not to return.

**Counts only, never the text.** This file does not log, but a step that throws is logged by
`src/jobs.ts` with `errorFields`, and article prose must not travel in an error
([logging.md](../project/logging.md)).

### The three rules the quote itself has to pass

- **`MIN_QUOTE_CHARS = 30`.** A six-word fragment is not a quotation, it is a phrase, and it will
  match half the article.
- **`MAX_QUOTE_CHARS = 400`.** A "quote" that is a whole 300-word block is the paragraph, not a line
  out of it. Dropped rather than truncated — truncating changes the author's words, which is the one
  thing this stage may not do.
- **No overlaps.** Two quotes resolving to overlapping spans in one block would draw two marks over
  one passage and offer the reader the same line twice. The **longer** span wins, on the glossary's
  `richness` argument: where one contains the other, the shorter adds nothing the longer does not
  already say, and "keep whichever came first" is a coin toss rather than a rule.

### How many

`suggestedQuotes(words)` — one per ~600 words, clamped to **4–16**. Between the glossary's density
(one per 400, clamped 6–20 — a term is a word the piece happens to use) and the ideas' (one per 800,
clamped 3–10 — an idea is something the whole argument leans on). A padded quote list is not a weak
entry a reader can skip; it is a *forgettable* line presented as memorable, which discredits the
other thirteen.

## Everything this touches

The `sketch` landing (`3897bc9`) and the `ideas` landing (`97c9ad5`, `2ce519d`) between them name
every seam. In dependency order:

**The artefact and the stage**
- `src/types.ts` — `Quote`, `Quotes`, `QuotesResponse`, `QuotesFound`
- `src/quotes.ts` — the stage: `SYSTEM`, `renderPrompt`, `toQuotes`, `dedupeOverlaps`,
  `inDocumentOrder`, `buildQuotes`, `idsByText`, `isStale`, `readQuotes`, `previousQuotesFrom`,
  `generateQuotes`, `main()` behind `stageCli`
- `src/source-hash.ts` — reuses `articleFingerprint`; nothing new
- `src/models.ts` — `AiJob` `"quotes"`, `STAGE_EFFORT`, `ARTICLE_RENDERER`, `ArticleStage`, wire,
  model class
- `src/ai-call.ts` — the job name union
- `src/pipeline.ts` — `STEP_ORDER`, `FORCE_ONLY_WHEN_NAMED`, the `STEPS.quotes` entry with its
  `stamp` and `run`
- `src/jobs.ts` — `STEP_BUDGET_MS.quotes` (a GUESS, in the glossary's family: 120s)
- `package.json` — `"quotes": "tsx src/quotes.ts"`

**The store**
- `src/store/artifacts.ts` — `ArtifactKind`, the read map, the validator, the id-carrying descriptor,
  the step→artefact map
- `src/store/artifacts-fs.ts` — `quotes.json`, the size cap and decoder
- `src/store/artifacts-pg.ts` — the column mapping
- `src/store/contracts.ts`, `src/store/pg.ts`, `src/store/pg-revisions.ts` (`carry`),
  `src/store/export.ts`, `src/store/import.ts`, `src/store/public-reader.ts`
- `src/db/schema.ts` — the `quotes` jsonb column and the step CHECK
- `drizzle/0033_quotes.sql` — **hand-written second statement.** `drizzle-kit generate` emits the
  `ADD COLUMN` and knows nothing about the CHECK; `tests/db-step-constraint.test.ts` is what makes
  sure it is not left behind a fourth time.

**The server**
- `src/api.ts` — `loadQuotes`, the three staleness facts
- `src/routes.ts` — `GET /api/quotes/:slug`, and the route comment
- `src/public-types.ts`, `src/public/dto.ts`, `src/public/route-names.ts` — `PublicQuotes`,
  `available.quotes`

**The reading view**
- `src/modes.ts` — `"quotes"` in `MODES`
- `src/title-text.ts` — the label
- `src/web/params.ts` — `quoteParam`, `RANKS`/`rankParam`, `barParam`
- `src/web/QuotesPanel.tsx` — the panel and its pure functions
- `src/web/useQuotes.ts` — the read, the job, the one verb
- `src/web/App.tsx` — `QuotesBand`, `VisitorQuotesBand`, `useQuotesMode`
- `src/web/Dock.tsx` — the chip, **after Ideas** (the order runs outwards from the article's own
  words, and Greg set it by hand)
- `src/web/search-hits.ts` — `resolveQuote`
- `src/web/visitor.ts` — the `NOUN` and `ARTEFACT` rows
- `src/web/public-artefacts.ts`, `src/web/lib/api.ts` (the 404-is-ordinary list),
  `src/web/lib/offline-store.ts`
- `src/web/styles.css` — `§ quotes mode`, reusing `.mode-band` and the glossary's provenance classes
  rather than declaring new ones

**Tests**
- `tests/quotes.test.ts` — the pure half of the stage
- `tests/quotes-panel.test.ts` — `priorityOf`, `countAbove`, `barMax`, `splitsOnBar`, `groupQuotes`,
  `rowScores`, `effectiveRank`, `barNote`
- and the existing exhaustive-`Record` tests that will redden until each map has a `quotes` row,
  which is the point of them

**Docs**
- `docs/project/quotes.md` (new), linked from `reading-view-overview.md` — one owner, which
  `tests/doc-links.test.ts` enforces
- `docs/project/url-state.md` — three new rows
- `docs/project/architecture.md` — stage 5h
- `docs/project/glossary.md` and `docs/project/ideas.md` — a See-also line each

## Five ways to break this quietly

1. **Trust the model's block id.** There isn't one, and adding one would reintroduce the whole
   `unknownIds` class for no gain. The block is ours, from `findQuote`.
2. **Store the list in bar order.** `quotes.json` stores document order, exactly as `glossary.json`
   does, so that `?rank=document` means the article's order and not the last writer's preference.
3. **Render `text` as HTML.** It is the author's prose, arriving through a model, into a panel. Plain
   text, like every other model-touched string here — [security.md](../project/security.md).
4. **Truncate an over-long quote instead of dropping it.** An ellipsis inside quotation marks
   attributed to a named author is a claim about what they wrote.
5. **Let `max` become `×` in one of the two places it is computed.** `priorityOf` is one function and
   the panel, the count, the track end and the groups all call it. A second copy is how the bar comes
   to say `5 of 14` over a list of six.

## What this deliberately does not do

- **No per-quote web check.** The glossary's "Check the web" answers *is the model's memory right*.
  There is nothing here for the web to check — the words are either in the article or they are gone.
- **No copy button.** Worth having, not in this landing: it needs a decision about whether it copies
  the quote, the quote and a citation, or a deep link, and that is its own small design.
- **No marks unless a quote is selected**, and no second selected quote. See above.
- **No `?quotes=` multi-select** the way search has `?runs=`. A reader comparing two quotes is
  comparing two sentences of one article, which is what the article is for.

## What is still open

- **`0.70` and `4–16` are guesses**, like `0.30` and `6–20` were. The slider is the feedback loop for
  the first; nothing is the feedback loop for the second yet.
- **`medium` is a guess.** See § Effort and the cache. It should go through
  `evals/results/effort-vs-quality.md` the way `arc` and `glossary` did.
- **No keyboard route into the list**, the same gap the glossary and ideas panels have, for the same
  reason ([keyboard.md](../project/keyboard.md) — ↑ / ↓ belong to the article).
- **Nothing generates quotes for the `example/` fixture**, consistent with the glossary and equally
  unsatisfying.

## See also

- [glossary.md](../project/glossary.md) — the mode this took its shape from: the prioritised order,
  the threshold slider, the scores and the condition attached to keeping them
- [ideas.md](../project/ideas.md) — the mode this took its *lifecycle* from: replaces rather than
  appends, one verb, no DELETE
- [search.md](../project/search.md) — where `Found`, the wash and the rail lane come from
- [block-ids.md](../project/block-ids.md) — why an occurrence is a block id and never an offset
- [url-state.md](../project/url-state.md) — `?mode=quotes`, `?quote=`, `?rank=`, `?bar=`, and why
  those last two are not called `sort` and `gate`
