# Quotes drawn as a stroke in the prose, with weight carrying priority

Greg, 2026-09-06, deciding a question [quotes.md § Still slate, not
yellow](../project/quotes.md#every-visible-quote-is-marked-and-the-bar-is-how-many) had recorded as
open:

> Perhaps use another UI convention, e.g. provide a border (i.e. the boundary but not the fill) for
> quotes, perhaps with bold, and use thickness and boldness as an indicator of the Quote priority.
> (I'm thinking in terms of the expanded Quote mode that I described elsewhere where we find a LOT
> more quotes, and provide a Prioritised submode with thresholding, as a way of highlighting the
> most important passages in the article to aid skimming.) Failing that, let's just use a
> fluorescent-yellow highlighter, and tweak the Search colourings to be pastel or something so they
> have a different feel to them.

**The border is the plan; the yellow highlighter is the fallback.** § *What would make me fall back*
says what would have to fail for the other branch to open.

**Status: Stage 0 is a gate, and it has not been passed yet.** This doc was reviewed by GPT Sol and
probed in Chrome before any feature code was written, and both passes changed it substantially.
§ *What the first review and the first probe changed* keeps the corrections, including the two
claims of mine that turned out to be false — they are the most useful thing on this page.

## Why a stroke is the right answer, and not just a different one

The question that produced this was "should quotes be yellow", and both obvious answers are bad:

- **Borrowing a hue** breaks the rule that hue means *which search found this* — Greg's own call,
  2026-08-26, written into [`annotations.css`](../../src/web/styles/annotations.css) § stacked hues
  and [colour-scales.md](../project/colour-scales.md).
- **A quotes-specific wash** adds a second way of drawing a marked passage, which is the thing the
  mode was built not to have ([quotes.md](../project/quotes.md)).

A stroke escapes both, because **it uses a channel nothing else uses**:

| Channel | Carries | Where |
|---|---|---|
| `background-color` (the wash) | a search's **confidence**, via `--hit-a` | `annotations.css:158` |
| `background-image`, a bottom band | **which search** found it, one stripe per run | `annotations.css:243` |
| `::after` glyph | a referee criterion's **direction** | `annotations.css:347` |
| **`box-shadow`** | **← this change: that the passage is a quote, and its priority** | new |

**Search fills; quotes outline.** And it does a second job: quote priority currently reaches the
reader only as list order and as the `?bar=` threshold, so the prose says nothing about which marked
passage matters most. Putting the ranking into the stroke is the skimming aid Greg's parenthesis
describes.

**The property to protect:** if a later design finds it needs a fill for quotes after all, the
reason this was chosen has been lost.

## The two blockers found before building, and what they cost

Both came from the GPT Sol review of the first draft. Neither was visible from the CSS alone.

### Blocker 1 — quotes have a fill today, so a ring would be "fill *and* outline"

`mark.hit`'s wash, hue band and pressed wash are **unconditional**. Quotes are `mark.hit`. So
adding a ring produces exactly what the brief says not to produce. Worse:

**A quote silently destroys the search-confidence channel it was supposed to leave alone.** A quote
becomes a `strength: 1` hit in `baseMarks` (`search-hits.ts:1209`), and `annotateHtml` takes
`Math.max` over every covering hit's strength — so **a quote lying over a 0.4-confidence search hit
repaints that hit's wash at 1.0**. That is a live bug today, not something this change introduces;
it is simply invisible while quotes and search look identical.

**The fix, and it is the real work of this plan:** split "is a hit" from "wants a search wash".

- A quote mark contributes a **tier**, and no strength and no hue.
- A search mark contributes **strength and hue** as now.
- `annotateHtml` writes `data-wash` when at least one covering mark actually wants search painting,
  and computes `--hit-a` over **those marks only**.
- The wash, the hue band, the bottom padding and the pressed wash move from bare `mark.hit` to
  `mark.hit[data-wash]`.
- A mark covered by both carries `data-quote` **and** `data-wash`, and draws both.

This also removes the quote-only bottom padding, which matters for the geometry below.

### Blocker 2 — one logical quote is not one `<mark>`

`annotateHtml` emits **one mark per text node**, and splits again at every annotation boundary —
documented at `annotate.ts:20` and asserted by `tests/annotate.test.ts:49`. So a single quote
becomes several sibling `<mark>` elements whenever it contains `<em>`, `<a>` or any inline markup,
or is partially overlapped by a search, a comment or a glossary term.

**A fill survives this invisibly; an outline does not.** Each sibling would draw its own complete
ring, so one sentence becomes three boxed pieces, with doubled opacity at the abutting seams.
`box-decoration-break` cannot help: it controls fragments *of one box*, never separate elements.

This is the finding that decides whether the border approach lives, and it is why **Stage 0 exists
and comes first**. Two candidate answers were judged in the browser; **the first one won** — see
§ *Stage 0, round 1*, where it is V3.

- **Caps only at the true ends.** `annotate.ts` already has this exact pattern for comments —
  `data-mark-end` is set on the run where `m.end` falls (`annotate.ts:384`), so a mark spanning
  three runs shows one marker. The analogue is `data-quote-start` / `data-quote-end`, with the
  inline-start and inline-end edges drawn only on those runs and the top/bottom rules drawn on all
  of them. Reconstructs one continuous outline across siblings.
- **No caps at all** — a rule above and below only, drawn as two zero-blur offset shadows, which
  tile seamlessly across abutting siblings because their left and right edges align with the box.
  Simpler, and a weaker reading of "boundary".

## The simpler options passed over

- **Just make quotes yellow.** One declaration. Passed over because it spends the hue channel,
  which is what 2026-08-26 decided not to spend. It remains the fallback.
- **A `border` on the mark.** Passed over — but **not for the reason the first draft gave**. See the
  corrections below: a border never grows the line box. It costs inline width per *fragment*, which
  with `clone` accumulates, and it overflows vertically into the leading.
- **A new `MarkKind: "quote"`.** Still passed over for the markup, but Sol is right that the first
  draft dismissed it too fast: the rail is computed from `Found` before prose markup, so a
  quote-specific *painting role* need not fork the rail. That is effectively what `data-wash` is.
- **Stroke thickness as a continuous function of the score.** Passed over: the probe shows even
  three discrete tiers is optimistic.

## The mechanism

### Geometry: what is actually true

Corrected against the CSS specs and measured in Chrome on this box.

- **An outset `box-shadow` does not affect layout — confirmed exactly.** Paragraph height, line
  count, fragment widths and the x of the first character after the mark are identical to three
  decimal places with the ring on and off (`114.188` / 4 lines / `90.484` both ways). This is the
  design's strongest asset and the reason to prefer it over every alternative.
- **It is not *contained*.** It reserves no room, so it may overpaint neighbouring lines and marks,
  and it does not extend scrollable overflow. `.prose pre` and `.prose table` are overflow
  containers (`prose.css:574`), so a ring near their padding edge can be clipped with no scrollbar
  to recover it. Stage 0 tests a mark on the first and last line inside a `pre`.
- **The line-gap is tight.** Fragment tops are 28.56px apart and marks are 22px tall, so a ring's
  bottom and the next line's ring top land ~1.5px apart and fuse into what looks like one heavy
  double rule. Removing the quote-only hue padding (Blocker 1) buys some of that back; the rest is
  a real constraint on how thick tier 3 can be.

### Naming: two properties, not one

The first draft used `--quote-stroke` as both a colour alias and a length, which is a direct
collision — whichever declaration won, the other became invalid. So:

```css
--quote-stroke-rgb: <tbd>;                        /* three numbers, for rgb(... / alpha) */
--quote-stroke-color: rgb(var(--quote-stroke-rgb));
--quote-stroke-width: 1px;                        /* the tier, set per data-quote */
```

`tests/css-tokens.test.ts` requires a `var()` without a fallback to name a real token, so the tokens
land in [`styles/tokens.css`](../../styles/tokens.css) before any rule reads them.

### Colour: not the orange

The first draft proposed `--highlight`, on the claim that brand orange is unused in the prose marks.
**That is false** — comments and glossary terms already use `--highlight` for their underlines and
selected washes (`annotations.css:39`). An orange ring around a passage that also carries a comment
would merge with the comment's underline and hide the one affordance in the prose you can click.

So the ring needs a hue that is distinct from: the eight categorical search hues, the low-chroma
slate wash, **and** the annotation orange. Stage 0 picks it with quote+comment and quote+term
specimens on screen, not from a swatch.

### Saying "this mark is a quote, at this priority" without a second run id

Quotes keep one `runId` (`QUOTES_RUN`) so the spine rail draws one lane rather than thirty-two;
per-quote identity stays in `Found.key`. **None of that changes.** The tier travels as an attribute,
following the `data-hues="N"` precedent — a small integer in the markup, the drawing in CSS:

```
data-quote="1" | "2" | "3"     3 = heaviest = highest priority
```

Design values stay in the stylesheet; a discrete attribute is assertable in jsdom.

### The mapping, and it is `priorityOf`

```ts
// src/web/QuotesPanel.tsx:242
export function priorityOf(quote: Quote): number | undefined {
  const scores = [quote.importance, quote.striking].filter((n): n is number => n !== undefined);
  return scores.length === 0 ? undefined : Math.max(...scores);
}
```

`?bar=` already thresholds on this. If the stroke encoded `importance` alone, raising the bar could
remove a heavy stroke while leaving a thin one — the bar and the stroke would contradict each other.
Encoding `priorityOf` gives the page the property worth having: **as you raise the bar, what
survives is exactly the heavier strokes.**

The brief said `Quote.importance`; Greg's own words were *"the Quote priority"*, and `priorityOf` is
the repo's name for exactly that. Sol's review independently reached the same conclusion and asked
for this to stop being described as a departure. It is the correct scalar.

| `priorityOf` | tier | `--quote-stroke-width` |
|---|---|---|
| ≥ 0.80 | 3 | `3px` |
| 0.50 – 0.79 | 2 | `2px` |
| < 0.50 | 1 | `1px` |
| **`undefined`** | **1** | `1px` |

**Integers, because 1.5px is not a tier.** The probe measured the first draft's 1 / 1.5 / 2.5px at
device scale 1: tier 1 is one fully-lit row, tier 2 is one fully-lit row plus one at ~50%, tier 3 is
two plus one at 50%. Tier 2 differed from tier 1 by a single half-intensity pixel — *"it does not
read as a heavier stroke, it reads as the same stroke with a soft, slightly blurred outer edge"* —
and it renders as a different thing again on a high-DPI screen, so the tier's appearance would be
display-dependent. 1 / 2 / 3px is the control Stage 0 tests, and **if three tiers still do not
separate, we ship two** (1px and 3px) rather than pretend to a ranking the reader cannot see.

0.80 is `QUOTE_BAR_DEFAULT`, so at the default bar the visible quotes are tier 3 and the lighter
tiers appear as the reader drags the bar down. That is the reason for the number.

**When priority is missing** the mark is tier 1 — visible, claiming nothing. It must be visible
because a quote scored on neither axis survives every position of the bar
([quotes.md](../project/quotes.md#the-bar-hides-what-is-below-it)), so an invisible one would be a
row in the panel with nothing in the prose. It must be light because it has not earned emphasis. The
CSS default is also `1px`, so a missing custom property degrades to a mark you can see.

### The pressed ring has to be redesigned

The pressed quote must draw its stroke and its "this is the row you pressed" ring in one declaration,
since `box-shadow` does not accumulate across rules. The first draft's version —
`w` then `calc(w + 1px)` — **fails at 1x**: the probe found two rows of orange, one row of blended
mud, then a single grey row. It reads as *the same ring, slightly thicker and dirtier*, which is
precisely not a state change.

It needs a real gap, so the halo is separated from the stroke by a ring of page colour:

```css
mark.hit[data-quote][data-hit-open] {
  box-shadow:
    0 0 0 var(--quote-stroke-width) var(--quote-stroke-color),
    0 0 0 calc(var(--quote-stroke-width) + 1px) var(--page),
    0 0 0 calc(var(--quote-stroke-width) + 2px) rgb(var(--hit-wash-rgb) / 0.8);
}
```

Whether a 1px gap is enough, and whether a page-coloured ring looks like a hole punched in the
paragraph, is a Stage 0 question. The alternative is to stop using shadow for the pressed state and
change the stroke's *colour* instead.

Sol confirmed the cascade is sound: `mark.hit[data-quote][data-hit-open]` outranks
`mark.hit[data-hit-open]`, and earlier shadows paint above later ones.

### Line wrapping: `clone` and `slice` are a real decision, not a formality

Measured, both ways, by scanning for lit pixel columns at each fragment edge:

- **`clone`** — all six vertical edges present. Draws **three complete closed rectangles**, one per
  line. Reads as *three separate highlights*.
- **`slice`** — only the true first and last edges are drawn; the four interior ends are absent.
  Draws **one box sliced open**: a cap before the first word, a cap after the last, top and bottom
  rules in between. Reads as *one continuous banded passage*.

The first draft asserted `clone` was obviously what we want. **The probe says the opposite is
arguable, and Sol independently flagged it as the visual-risk decision rather than a detail.** The
acceptance question is therefore not *"did Chrome close every fragment?"* but **"does one wrapped
quote still read as one quote?"** — and on that question `slice` currently looks better.

This interacts with Blocker 2: `slice` gives the right appearance *within* one element, and the
`data-quote-start` / `data-quote-end` caps give the same appearance *across* sibling elements. They
are the same idea at two scales, which is a good sign.

(The existing `clone` on `mark.hit` was chosen for the *background band*, where the probe recorded
`clone` and `slice` as pixel-identical because the band is positioned in percentages. Whatever this
change does must not disturb that.)

### Overlaps

- **Quote over search hit** — measured: readable, no contrast loss, both signals independently
  identifiable. The nit is that a ring flush on the wash's edge reads as "a bordered box" rather
  than as two systems stacked. Revisit once the wash is removed from quote-only marks (Blocker 1).
- **Quote over quote — cannot happen.** `dedupeOverlaps` (`src/quotes.ts:610`) drops any quote whose
  span clashes with a longer kept one in the same block. So the nested-outline lie — two rings
  reading as one heavier mark, i.e. as a priority neither quote has — is prevented at the artefact.
  Stage 1 asserts it directly, because it is now load-bearing for the *drawing* and nothing says so.
- **Quote over comment / glossary term** — new, and the reason the colour cannot be orange.

### Bold, and the honest reason for dropping it

Greg wrote *"perhaps with bold"*. The first draft rejected it because it *"reflows the article"*.
**The measurement does not support that as stated**: `font-weight: 600` left the paragraph at
114.188px and 4 lines, exactly as unbolded.

What it actually does is **re-wrap**: the text following the mark moved 80.4px, and the paragraph's
last line grew from 104px to 200px of content — close enough to spilling that different text would
have added a line. So: **bold re-wraps the prose and will sometimes add a line.** With quotes on a
slider, every drag would reshuffle the words the reader is looking at. That is still disqualifying,
but it is a smaller and more precise claim than the one first made.

Sol also notes the first draft's "no non-reflowing bold exists" was too broad — `text-shadow` and
`-webkit-text-stroke` thicken glyph paint without touching layout. They are rejected too, and the
stated reason is the right one: they degrade glyph shapes, and they restyle the author's words to
advertise our annotation, which is the thing `annotations.css` refuses when it says *"recolouring
the author's prose to advertise our annotation is the small version of the thing vision.md
refuses."*

**So thickness carries priority alone.** A reduction against the brief, called out rather than
absorbed — and not a large loss, since thickness is a non-colour carrier and so survives greyscale
and every dichromacy without a second channel
([colour-scales.md](../project/colour-scales.md#colour-is-never-the-only-carrier)).

### There is only one theme

The brief asked for light and dark. **That is generic guidance this project has explicitly
overridden**: the reading view is dark only, unconditionally — no toggle, no `prefers-color-scheme`,
no light fallback (Greg, 2026-08-24;
[design-css-overview.md](../project/design-css-overview.md)). Adding a `prefers-color-scheme` block
would re-add the thing that decision removed. What is honoured is the rule underneath: **the colour
is a token, not a hard-coded value.**

## Stages

Each stage ends with a GPT Sol review, `npm test` and `npm run typecheck`.

### Stage 0 — the gate: does a stroke survive the real markup?

**No feature code until this passes.** A throwaway page rendered through the **real `annotateHtml`**,
not hand-written `<mark>` markup — hand-written specimens cannot show the principal failure, which is
DOM splitting. Cases:

- a quote containing `<em>` and an `<a>`; two abutting quotes; a quote partially overlapped by a
  search, by a comment, and by a glossary term;
- `clone` vs `slice`, and caps-at-true-ends vs no-caps, on all of the above;
- 1 / 2 / 3px at device scale factors 1 and 2 and at 100% and 125% zoom, judged by **blind pairwise
  identification** — "which of these two is heavier" — not "can you see a difference", which anyone
  who knows the answer can talk themselves into;
- a mark on the first and last line inside a `pre`, for the clipping question;
- the redesigned pressed ring at 1x;
- candidate ring colours against a comment underline and a glossary term;
- **both densities**: a realistic one (one quote per 300 words is often only one or two in a
  viewport) and a deliberately dense worst-case paragraph.

Stage 0 either produces a treatment that survives all of that, or it produces the reason to fall
back — and either is a good outcome.

### Stage 1 — carry the tier to the mark, and split the wash from the hit

Data path; no visual change on its own. Seven edits, not six:

1. `QuotesPanel.tsx` — export `quoteTier(quote): 1 | 2 | 3` beside `priorityOf`, holding the
   thresholds, so the test and `/design` read the same numbers.
2. `search-hits.ts:669` — `resolveQuotes` carries the tier.
3. `search-hits.ts` — `resolveOne`'s spec and the `Found` interface gain the field. Written out at
   every call site rather than defaulted, following the convention `valence` documents there.
4. `search-hits.ts:1209` — `baseMarks` copies it onto the `Mark`, and **stops giving quotes
   `strength`**.
5. `annotate.ts:170` — `Mark` gains the field.
6. `annotate.ts:397` — write `data-quote`, write `data-wash` for marks that want search painting,
   and compute `--hit-a` over those marks only. **`mark.hit` gains `background: none`** at the same
   time, or a quote-only mark falls back to the UA default yellow — see § *Stage 0, round 1*.
7. **`src/sanitize-policy.ts`** — add `data-quote` and `data-wash` to `FORBID_ATTR`, and bump
   `SANITIZER_VERSION` 5 → 6 because the policy got stricter. Every attribute `annotateHtml` writes
   must be reserved so an article cannot forge app-owned presentation; `data-hues` and `data-dir`
   were each forgotten once already, and the file's own header records both.

Tests: `tests/quote-marks.test.ts` gains the attribute, the mapping, the unscored case, and that a
search-only hit has no `data-quote`. A new assertion that a quote does **not** raise a search hit's
`--hit-a` — the Blocker 1 bug, which nothing currently catches. The `dedupeOverlaps` non-overlap
property. Sanitiser tests get `<mark class="hit" data-quote="3">`.

**Known breakage:** `tests/mode-surface-changes-no-markup.test.tsx:1025` builds a fixture with
`importance: 90`, bypassing `place`'s 0–1 validation. Nonsense under a 0–1 mapping; fix it here.

### Stage 2 — draw it, and put it on `/design`

The tokens, the `mark.hit[data-quote]` rules, the tiers, the pressed ring, and the `[data-wash]`
move. `/design` gets the first `mark.hit` specimen it has ever had — **built through `annotateHtml`**
so it shows the split cases, not idealised markup.

### Stage 3 — the browser pass on a real article

A long article with the bar low. Reports the honest impression against the sentence the last pass
earned — *"reads comfortably… a few sentences someone marked, not a wall of highlighter"* — which
this version must survive with far more marks. Local articles top out at 15 quotes, so
`qstroke-seed.mts` puts 32 synthetic ones (verbatim substrings, spread across all tiers and the
unscored case) on a 186-block article, backing up what it replaces because the local database is
shared with every other worktree on this box.

### Stage 4 — the docs

[quotes.md](../project/quotes.md) § *Still slate, not yellow* becomes § *The stroke*, and records
what was decided. This doc gets the findings from every round.

**[design-css-overview.md](../project/design-css-overview.md) is deliberately NOT edited**, and it
should be. It is one of the seven entry points, and CLAUDE.md requires those to be edited one
approved set at a time with before and after shown — which this run could not do, having nobody to
ask. What it wants is a line for `--quote-stroke-rgb` / `--quote-stroke-color` beside the other
colour tokens. Left for Greg rather than slipped in.

## Stage 0, round 1: the gate passes, three sub-designs fail

Judged in Chrome on the box, against markup from the real `annotateHtml`. The splitting is not
theoretical — measured, one mark in:

| case | `<mark>` elements out |
|---|---|
| plain quote | 1 |
| **quote containing `<em>`** | **3** |
| **quote containing `<a>`** | **3** |
| quote ∩ search / comment / glossary term | 3 |

**THE GATE PASSES, with V3 — caps only at the true ends.** The four candidates, on identical markup:

| | split quote reads as one? |
|---|---|
| V1 full ring, `clone` | **no** — one sentence becomes three boxes, with a double bar at each seam |
| V2 full ring, `slice` | **no** — `slice` merges fragments of *one element*; it does nothing across siblings |
| **V3 rules always, caps at true ends** | **yes** — no gap at the seam, only a 14% antialias dip visible at 4× |
| V4 no caps at all | yes, trivially — but loses the abutting case and the "quote ends here" signal |

Ranking: **V3 > V4 > V2 > V1**. V3 is the design.

**A real bug found by the harness being wrong.** The probe page painted every quote solid browser
yellow, because `mark.hit` never resets the UA default `mark { background-color: Mark }` — it gets
away with it today only by setting a background unconditionally. **Moving the wash to `[data-wash]`
takes that away and the yellow comes back.** `mark.cmt` and `mark.term` each carry `background:
none` for exactly this reason; `mark.hit` must too. That is now part of Stage 1, and it is a
pleasing coincidence that shipping the bug would have produced Greg's fallback by accident.

What else the round settled:

- **The overlap works.** Quote ∩ search: left fragment green rules only, middle green rules over
  grey wash and blue confidence band, right wash and band only. Two systems, both legible.
- **Green survives the orange.** The comment underline and the dotted glossary underline stay
  visible and distinct beside a green rule. Two caveats: the comment's `border-bottom` grows the
  mark's border box, so the quote's bottom rule steps down 1px where the comment starts; and at
  tier 2–3 you can end up with three stacked horizontal lines under one word.
- **No clipping in `pre`.** Its 11.2px padding clears a 3px ring. Any `pre` padding under ~4px would
  clip it.

And three failures, all now re-probed in round 2:

- **The tiers are not distinguishable.** Blind pairwise, 20 trials: tier 1 vs 2 scored 7/10, tier
  2 vs 3 scored 6/10 — **13/20 overall, which is chance**, and the answers correlated with slot
  position rather than with thickness, the standard tell for guessing. The rules render exactly as
  specified (1/2/3 device px at dsf1, 2/4/6 at dsf2, full-strength colour, no partial alpha), so
  the mechanism is right and the *perceptual step* is too small. Round 2 asks whether **two** tiers
  (1px vs 3px) separate.
- **Density fails the benchmark.** Five quotes in one paragraph read as a form or a table, not as
  *"a few sentences someone marked"*. But **one quote per paragraph reads very well** — calm and
  unambiguous. So this is a question about how often quotes fire, which is Sol's point that
  `MAX_QUOTES = 32` is per *article*: at one per 300 words a viewport usually holds one or two.
- **The pressed state fails again.** Stroke, 1px page-coloured gap, grey halo comes out as four
  device rows whose entire distinguishing signal is one grey hairline — *"a slightly thicker ring
  with a faint fringe, not a different state"*. More pixels of ring is the wrong answer; round 2
  tries changing its colour instead.

## Stage 0, rounds 2 and 3: the three failures, answered

**Tiers — two, not three.** Blind pairwise, twelve pairs, key withheld until after the answers were
written: **12/12 at device scale factor 1 and 12/12 at dsf 2** for 1px against 3px, with no position
bias (the key was 8 upper / 4 lower and a constant "upper" would have scored 8/12, so the floor is
8, not 6). The judge's note is the useful part: *"in every pair the heavier one was obvious on first
look… there was no pair where I hesitated"* — a different subjective experience from the 3-tier test
that scored 13/20. **The finding is narrow and specific: 1-vs-3 is obvious, and everything involving
the middle tier is marginal.** So `QuoteTier` is `1 | 2` and the widths are 1px and 3px.

**The pressed state — colour, not more pixels.** Four candidates. A white stroke plus a faint wash
won: two channels change at once, so it survives a fast click. Orange was equally visible and
**rejected** — it reads as *"this passage is a comment"*, because orange is already the annotation
colour, and reusing it teaches the reader that one colour means two things. A wash alone was
weakest: with the stroke untouched a pressed quote looks like an ordinary one. Note the asymmetry
that decides it — thickness already means priority, so *more thickness* is the one channel that was
not free to borrow: it would have said "more important" where it meant "you pressed this".

The wash in the pressed state does **not** undo "quotes outline, search fills". It is a button's
`:active` background — momentary, tied to the row being pointed at, gone when the reader moves on.
The resting state of every quote on the page is still an outline and nothing else.

**Abutting quotes — inset caps.** Round 1 called the outset version *"detectable but weakly"*.
Round 3 measured it and it is worse than that: at tier 3 the two facing caps are 3px each across
5.35px of word space, so they **overlap and fill it completely** — zero background pixels, the two
quotes welded into one band. *"At reading speed it reads as one quote, full stop."* Inset caps leave
6px of clean page. The fix is a sign flip and the `inset` keyword in three rules that already exist,
and it has a second benefit: an outset cap on a quote that begins a line hangs into the left margin
and breaks the text column's edge, where an inset one cannot.

Its cost, recorded rather than hidden: the cap sits on the first or last 3px inside the mark, so a
terminal full stop sits on green and reads as slightly swallowed. Inset shadows paint above the
background and below the text, so no glyph is ever hidden.

**Round 2's Q3 could not be judged at all the first time**, because the specimen was mine and it was
broken — the abutting markup never got `data-quote`, so nothing was drawn and the whole section was
blank. Worth recording because the judge caught it rather than reporting a confident opinion about
an empty page, which is the failure this kind of pass is most prone to.

## What would make me fall back to the yellow highlighter

Fixed before the evidence arrives, so the bar cannot move to meet the result.

1. **The tiers are not distinguishable** at reading distance, blind — and two tiers are not enough
   to be worth a new channel.
2. **The marks read as noise** — boxes-in-prose, a form rather than annotation.
3. **The seams lose.** No arrangement of caps makes a split quote read as one quote. *This is now
   the most likely of the four*, and it is Blocker 2.
4. **The ring collides** with the wash, a comment underline or a glossary term in a way no colour
   choice fixes.

The fallback is Greg's second sentence: fluorescent yellow for quotes, search recoloured to pastel
so the two feel different. The pastel change is **part of that fallback**, not a separate project,
and would need its own contrast check against `colour-scales.md`. If we fall back, the interesting
result is *which* of the four failed, and it gets written here.

## What the first review and the first probe changed

Kept because the corrections are more useful than the conclusions, and two of them are mine being
wrong about CSS.

| First draft said | Actually |
|---|---|
| A ring is a free channel | Quotes **already have a fill**; it has to be taken away first (Blocker 1) |
| One quote is one `<mark>` | It is one mark **per text node and per annotation boundary** (Blocker 2) |
| A `border` grows the line box | **It never does.** It costs inline width per fragment and overflows into the leading |
| Bold reflows the paragraph | Height and line count **unchanged**; it re-wraps, moving following text 80px |
| 1 / 1.5 / 2.5px is three tiers | 1.5px is **one half-lit pixel** — a smudge, and display-dependent |
| `clone` is obviously right | `clone` reads as **three separate highlights**; `slice` reads as one passage |
| The composed pressed ring works | **Fails at 1x** — the halo is a single grey pixel behind a blended one |
| Orange is unused in the prose | Comments and glossary terms **already use it** |
| Six edits in Stage 1 | Seven — `FORBID_ATTR` and `SANITIZER_VERSION` were missing |
| `--quote-stroke` | A colour and a length **cannot share one property name** |
| 32 quotes fill a screen | 32 per *article*; at one per 300 words a viewport often holds one or two |

Sol confirmed two things unchanged: `priorityOf` is the correct scalar, and the pressed rule's
cascade is sound.

## The code review, and the three things it left open

The built code went back to GPT Sol, weighted higher than the plan review. Six findings; three fixed
here, three recorded. It also corrected the write-up on a point worth being exact about.

**Fixed:** the `/design` specimens were injected into a `<p>` when each is already a whole `<p>`,
making `<p><p>…</p></p>`; the sanitiser test still covered only `data-hit` and `data-hues`, so the
four new attributes were forbidden but unasserted — the omission this list has now suffered three
times; and a quote in a **right-to-left** block would cap itself inside out, because
`data-quote-start` is a *logical* end and a `box-shadow` offset is a *physical* one, so a split RTL
quote would be capped on its two internal seams and left open at both ends. A single-fragment quote
hides that completely, which is what makes it the kind of bug a browser pass would not find.

**Three comments asserted things that are not true**, and all three are corrected in place:

- The `slice`-is-safe explanation inherited from 2026-08-26 — that percentages resolve per fragment,
  so `clone` and `slice` cannot disagree — **is contrary to CSS Fragmentation §5.4**, which says
  `slice` uses the unbroken box's geometry. The Chrome measurement stands; the theory does not, and
  it cannot be used to predict Firefox or Safari.
- `Mark` does **not** type-enforce the `strength` / `quoteTier` exclusivity. Both are optional; only
  `baseMarks` decides. A discriminated union would enforce it and is the right shape if a third kind
  of painting arrives.
- The stroke green is **not** "away from the categorical palette": `--cat-2-rgb` is `47 191 149` and
  this is `122 200 160`, the same family. See § Open questions.

**And one claim of mine was too strong.** The wash bug — a quote repainting a hedged search hit's
confidence at full — is real in `annotateHtml`, but **not reachable by a reader**: one mode's marks
are on the page at a time, so a quote and a search hit are never drawn over one phrase. It is a
broken renderer contract, not something anybody has been seeing. The first commit message on this
branch says "live bug"; this is the correction.

### Left open, deliberately

- **The pressed subtype is lost on a mixed run.** `data-hit-open` is emitted when *any* covering hit
  is open, so an open search over a quote and an open quote over a search produce identical markup,
  and both pressed rules fire. Sol's fix is separate `data-wash-open` / `data-quote-open`. Not built,
  because the state is unreachable while modes are exclusive, and because inventing two more reserved
  attributes for it would want the sanitiser bump and the tests that go with them. **It is the first
  thing to build if quotes and search are ever drawn together.**
- **Foreign content leaves an outline uncapped.** SVG and MathML text is counted in the offset space
  but never wrapped, so a quote that starts or ends inside a diagram gets only one cap, and a
  `whole: true` fallback spanning leading and trailing SVG gets neither. The fix is to cap the first
  and last *wrappable* run rather than requiring the stored boundary itself to be wrappable. Rare,
  cosmetic, and a real edge — recorded rather than hidden.
- **The hue.** See § Open questions.

## Stage 3, the acceptance pass: ship it, with one defect

On the real article, signed in, 1280px. **The verdict is that the outline survives the sentence the
wash version earned** — *"a few sentences someone bracketed, not a wall of boxes, not a form, not a
table"* — and it held when pushed past the density it will actually see.

**The seed was 16× too sparse and the pass worked round it, which is the useful part.** 32 quotes
over 152,077 words is one per ~4,750, not the one per 300 the design assumes, so a 900px viewport
showed **nothing at all on about eleven screens in twelve**. `qstroke-seed.mts` strides over text
*blocks*, and this article has 1,766 of them but is enormous. So the crowded case was built by
injecting extra marks into the real prose in the browser:

| density | quotes per viewport | verdict |
|---|---|---|
| as seeded (1 per 4,750 words) | 0–1 | nothing to judge |
| the design assumption (1 per 300) | 1–2 | calm |
| **3× the assumption (1 per 90)** | **3–4** | **still reads as bracketing, not tabulation** |

What rises with density is a faintly *ruled* quality, because a wrapped quote draws a rule in every
interline gap it crosses; a paragraph with two multi-line heavy quotes is the closest thing to the
failure mode, and even there it reads as bracketing. It is better than a wash would be at that
density, because a wash would have filled half the paragraph.

**The priority does help skimming — but through brightness more than thickness.** 3px at 95% alpha
simply carries more green than 1px. The heavy ones read as bright brackets that catch the eye and
the light ones recede to a hairline. The useful outcome, even though the mechanism is not quite the
one on the tin.

**Everything else checked out**: wrapping reads as one quote (22 of 32 wrap); a split quote's three
fragments are exactly contiguous with no seam; the pressed white stroke is unmistakable; no stray
yellow anywhere — every quote-only mark computes `rgba(0,0,0,0)`, so the `background: none` guard is
doing its job; no stroke escapes its cell; no reflow; holds at 1024 and 900.

### The step where a quote crosses a search hit

**The one real defect.** `mark.hit[data-wash]` adds `padding-bottom: 2px` to make room for the hue
band, so a fragment carrying both a quote and a search hit is **2px taller than its quote-only
siblings** — and the quote's bottom rule therefore steps down 2px where the search hit begins and
back up where it ends. Measured on `/design`: bottom 738.78 against 736.78.

**Not fixed**, and the reasoning is worth stating because it is a judgement rather than an
oversight. It is unreachable in the reading view — one mode's marks are on the page at a time — so
today it appears only on `/design`, whose specimen label now names it rather than claiming the
opposite. And the cheap fixes are each wrong: giving every quote the same 2px padding levels the
rule but eats 2px of a 5px interline gap, which would fuse the rules of adjacent lines; and a
`box-shadow` offset cannot place a bottom rule *inside* a taller box without becoming an inset band
of the wrong height. The right fix is to stop the quote's bottom edge riding the padded box, and it
belongs with whoever makes quotes and search coexist. **It is the second thing to build if they
ever do**, after the pressed-subtype split.

### The doubled hairline between lines

Cosmetic, inherent, and recorded because it is the thing the pass said it would change if anything.
Line boxes are 27px apart and mark boxes 22px tall, leaving 5px. A **light** quote's bottom rule and
the next line's top rule are 1px each, so they sit 3px apart and read as a faint double rule — a
little like ruled paper. A **heavy** quote's 3px rules overflow that gap and fuse into one ~6px
band, which is why heavy multi-line quotes look chunkier inside than their own outer edges do.

## Known gap: the paragraph rail still wears a search colour

**Not fixed here, and it is a real inconsistency this change introduces.** The bar down the left of
a marked paragraph (`td.text.has-hit`) is driven by `blockHues`, which reads `Found.slot` — and
every quote has slot 0, so a paragraph containing only quotes draws a rail in the first *categorical
search* hue. That was coherent while the mark in the prose wore the same hue as a band. It is not
any more: the phrase is now outlined in green and the rail beside it is search-blue, so the two say
different things about the same passage.

Three reasons it is left alone rather than swept up:

- It is **pre-existing behaviour**, deliberately chosen — quotes take a real slot rather than `null`
  precisely so the paragraph bar is not blank (`useQuotesMode`'s own comment says so).
- The rail answers a coarser question than the mark — *"one of yours is in here"* — so it is
  arguably allowed to be a neutral "marked" colour rather than the mark's own. **Except that it is
  not a neutral colour**, which the browser pass measured and this section originally got wrong: it
  computes to `rgb(86 180 233)`, i.e. `--cat-0-rgb`, *the first categorical search hue*. So a
  quote-marked paragraph is flagged in the colour that specifically means "saved search #1 matched
  here", and a reader with a search running would have one blue meaning two things. That is a
  latent collision rather than a cosmetic mismatch, and it raises the priority of the follow-up.
- Fixing it means teaching `blockHues` about quotes, which is a second change to the same seam and
  belongs with somebody looking at the rail, not bolted onto this.

`blockStrength` is **not** affected: it reads `Found.confidence`, not the mark's `strength`, so
splitting the two in `baseMarks` did not change the rail's intensity. Checked rather than assumed.

**The browser pass's judgement:** not confusing *today*, because in Quotes mode at 1280px the rail
sits at x=412 against a panel edge at x=413 and reads as panel chrome rather than as a mark; at
1800px it sits in an empty gutter far from the words. So it goes on the follow-up list rather than
the blocker list — and the fix is to **give the rail its own hue** (the quote colour, or a genuinely
neutral one), not to make it green to match.

## Open questions for Greg

Recorded rather than asked, since this ran autonomously.

- **Bold is out**, on the measured reason above rather than the one first given. If re-wrapping on
  every drag of the bar is acceptable to you, it is a one-line change.
- **If Stage 0 says three tiers do not separate**, the plan is to ship two rather than fake a
  ranking. Say if you would rather have three at a larger step, which costs vertical room in a
  28.56px line box that is already tight.
- **Blocker 1 is a broken renderer contract, not a live bug** — a quote over a search hit repaints
  that hit's confidence wash at 1.0 in `annotateHtml`, but modes are exclusive so no reader has seen
  it. Fixed here because this change forces it, and because the design's central claim is that the
  two channels are independent.
- **The stroke's green is in the same family as `--cat-2`**, the categorical "bluish green". Not a
  collision a reader can currently reach — it would take a quote and a search drawn at once — and
  the defence is that a stroke and a wash are different channels rather than different hues. But
  "away from the palette" was not achievable: all eight slots plus the brand orange and the slate
  wash are spoken for. **Violet is the least-used gap** if you want the stroke moved; it is a
  one-token change and the browser pass would need re-running.
