# Review: a Quotes mode — the lines worth keeping, in the author's own words

You are reviewing a **plan, before any code is written**, in the spideryarn2
repository at /Users/greg/Dropbox/dev/experim/spideryarn2.

This is the plan-stage review. The code will come back to you separately.

## What was asked for

Greg, 2026-08-31, verbatim:

> Create a "Quotes" mode that extracts the most central, helpful, interesting
> quotes. By default, display them in order. But also have a sub-mode for
> ordering them by importance, and a sub-mode for ordering by how
> memorable/interesting/striking/lyrical/etc. And add a threshold UI bar, and a
> Prioritised mode. Take inspiration from the Glossary mode.

Two follow-up decisions he made when asked (both are in the plan):

- The threshold bar combines the two scores with **`max`**, not the Glossary's
  product — "either reason is enough".
- The model's one-line reason for picking a quote is shown **as a tooltip**, not
  as body text in the list.

## Read, in this order

1. `docs/plans/quotes-mode.md` — the plan under review.
2. `docs/project/glossary.md` — the mode this is shaped on. The sections that
   matter most: "The scores, and the condition attached to keeping them",
   "Prioritised, which is now the default", "The threshold, and whose it is",
   "A prompt ban relocates a register", and "Five ways to break this quietly".
3. `src/web/GlossaryPanel.tsx` — `sortEntries`, `priorityOf`, `countAbove`,
   `canPrioritise`, `gateMax`, `splitsOnPriority`, `effectiveSort`, `gateNote`,
   `groupEntries`, `rowScores`, `GateSlider`. This is the code the plan proposes
   to mirror with `max` substituted for `×`.
4. `src/glossary.ts` — the stage: `SYSTEM`, `toEntries`, `findOccurrences`,
   `inDocumentOrder`, `buildGlossary`, `safeUrl`.
5. `src/ideas.ts` — the *other* parent. Specifically `validateOccurrences`,
   `Dropped`, `toIdeas`, `idsByName`, and the "replaces rather than appends"
   lifecycle the plan takes from here.
6. `src/quote-match.ts` — `findQuote`, `reduce`, `nearestIndex`, `snippet`. This
   function is the entire safety property of the proposed feature.
7. `src/web/search-hits.ts` — `Found`, `resolveOne`, `resolveIdea`, `orderFound`,
   and the `prioritised` search order at the end (a *third* take on
   threshold-plus-order, which hides rather than groups).
8. `src/pipeline.ts` — `STEP_ORDER`, `DEFAULT_INGEST_STEPS`,
   `FORCE_ONLY_WHEN_NAMED`, and the `STEPS.ideas` and `STEPS.glossary` entries.
9. `src/models.ts` — `STAGE_EFFORT`, `ARTICLE_RENDERER`, `sharesArticleCache`'s
   two tables.
10. `CLAUDE.md`, `docs/project/vision.md`, and `docs/reusable/silent-success.md`
    for the house rules.

## What I most want you to attack

### 1. The safety property, which is the whole feature

The plan's central claim is: **a quote that `findQuote` cannot locate verbatim in
the article is dropped, never shown.** Everything else in the mode is downstream
of that, because the failure this feature can have and no other stage can is a
plausible paraphrase, in quotation marks, attributed to a named author, sitting
next to the real text.

Attack it. Specifically:

- `findQuote` has **two passes**, and the second drops whitespace entirely — its
  own docstring says "in the end" would match "inthe end". The plan proposes
  running it over **every block of the article** rather than over one block the
  model named (which is what `validateOccurrences` in `src/ideas.ts` does). Does
  searching N blocks with a forgiving matcher change the false-positive rate
  enough to matter? Construct a case where a model paraphrase is *accepted* by
  pass two against some block of a real article.
- The `FOLD` table in `quote-match.ts` folds curly quotes and dashes. What
  retyping does a model actually do that is **not** folded — and would therefore
  drop a perfectly good quote? Is the drop-rate risk here big enough that the
  design is wrong (i.e. the model should be shown ids and asked to copy bytes)?
- Is "drop and count `unfound`" the right response, or should an unfound quote be
  surfaced to the reader some other way? Note the repo's rule that a check you
  have never seen fail is not evidence, and that this counter is the *only*
  instrument on the failure mode.

### 2. `max` instead of `×`, and everything downstream of that substitution

Greg chose `max`. I want you to check the **consequences** rather than re-litigate
the choice, because several of the Glossary's design decisions were justified by
properties of a *product* and the plan carries them over:

- **`PROMOTE_BAR = 0.70` vs the Glossary's `0.30`.** The plan's argument is that a
  product clusters low and a maximum clusters high. Is 0.70 defensible, or does
  `max` over two clumped model scores collapse to "almost everything is 0.8" and
  make the bar useless across most of its travel?
- **`barMax` ends the track at the data's own maximum, rounded down to the step.**
  Under a product that made both ends meaningful. Under `max`, does the right-hand
  end still promote exactly one quote, or can several quotes tie at the top score
  and make the right end promote five?
- **The missing-score rule.** The plan claims: `priorityOf` takes the max over
  whichever scores are present, and that this is safe because a max over a subset
  can only *under*-promote. Is that reasoning sound? Is it the right behaviour, or
  is it inconsistent with the Glossary's own stated rule that "an entry the model
  declined to score is not one it scored as trivial"?
- **`rowScores`.** The Glossary's rule is "a row shows exactly the numbers its
  position was decided on". Under `max`, only *one* of the two scores decided the
  position. Should a prioritised row show both, or only the winning one? The plan
  says both. Is that a small lie?

### 3. The reason-as-tooltip

The plan argues a tooltip is *stronger* than a labelled section, because the
"describes the page the reader is looking at" register — the failure the Glossary
spent a whole rewrite fixing — is the *default* register for the question "why
this quote".

- Is that argument right, or is it a rationalisation of a UI preference?
- A tooltip is the only route to that content. `Tooltip.tsx` opens on focus as
  well as hover, but the plan also says the quote row is a button and there is no
  keyboard route into the list at all (an existing gap in Glossary and Ideas).
  Does that make `reason` **unreachable** for a keyboard or screen-reader user,
  and if so is that a blocker rather than a known gap?
- Is there a third option neither of us named?

### 4. The lifecycle: replaces, does not append

The plan takes the Ideas lifecycle (replace, one verb, no DELETE, no `passes`)
rather than the Glossary's (append, `Find more` / `Start again`, FORBIDDEN list).
The justification is "a piece has a dozen quotable lines, not an encyclopaedia".

- Is that true? A 10,000-word essay at one-per-600-words is 16 quotes and the cap
  is 16. Does the cap silently become the *answer* on long articles, the way the
  Glossary's `BATCH_SIZE` did — and if so does that argue for the append path
  after all?
- `idsByText` inherits ids across a rewrite, keyed on a normalised quote form. The
  Glossary's `idsByTerm` keys on names and aliases; Ideas' `idsByName` on names.
  A *quote* is long text. What normalisation is right here, and what breaks when a
  re-run returns the same sentence with one more clause?

### 5. Cache sharing, which the plan asserts

`STAGE_EFFORT.quotes = "medium"` and `ARTICLE_RENDERER.quotes = "text"` are chosen
so this stage shares a cached article prefix with `glossary`. Check that against
`sharesArticleCache` in `src/pipeline.ts` and the two tables in `src/models.ts` —
is the claim actually true, and is anything else about the request (system block
order, `thinking`, `max_tokens`) different enough to break the prefix? Note that
`docs/research/prompt-caching-anthropic.md` records that `effort` **is** in the
cache key and `temperature`/`max_tokens` are not.

### 6. Anything the plan does not mention at all

The seam list in "Everything this touches" was built from the `sketch` and `ideas`
landings. Name what is missing. In particular I am unsure about: the sanitiser
(`src/sanitize-policy.ts`), `src/block-policy.ts` (which blocks the prompt may
read — quotes must surely not come from the bibliography or the footnotes),
`src/labels.ts`, offline caching, and `scripts/deploy-checks.ts`.

## What a useful answer looks like

Findings, most important first. For each: **what breaks, the concrete input or
sequence that breaks it, and what to do instead.** I would rather have four
findings I have to act on than twenty I have to triage.

Be blunt about anything you think is simply the wrong design. If the whole idea of
a Quotes mode is redundant against Summary or Search, say so and say why — that is
a finding, not rudeness.
