# A search box in the glossary, to look a term up

**[SPIDERYARN-READING2-Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-Y)** · reported
2026-09-04 · *built, cut down — the "add it" half is deferred, and there is a decision below for
Greg*

## What the reader said

> I would like to be able to type into a search box in the glossary for a particular term and for it
> to look for that term and add it to the glossary. And maybe it should be a tiny bit robust in the
> spelling or something if I type it wrong.

## What shipped

A **Look up a term** box at the top of the glossary band, owner only. It finds the term in the
article's prose with the matcher the underlines already use, and explains that passage through the
same `explain()` call *Check the web* uses — the two verbs share `anchorIn`, so there is one anchor
rule and not two. `POST /api/glossary/:slug/ask`, `makeAskAboutTerm` in
[`term-lookup.ts`](../../src/term-lookup.ts), `AskATerm` in
[`GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx).

**The article's own words are what the model is told about**, not the reader's: type *criminal* at a
piece that says *criminals* and the quote is the plural. A side effect worth having — the reader's
typed string never reaches the model at all.

## "A tiny bit robust" is exactly case, plurals and possessives

`term-match.ts`'s folding and nothing more. **No fuzzy matching, and no "did you mean…"** — proposed
in the plan and rejected on the day: the matcher gives no typo tolerance to build a ranking on, and
the word a reader wants is as often a lowercase idea as a proper noun, so the article's proper-noun
list would miss the commonest case while looking confident. Guessing here is the `-X` postmortem's
fault in a friendlier tone.

## "Add it to the glossary" is deferred, and this is the one to read

Three reasons, each checked in the code rather than taken from the review that raised them:

1. **The glossary is one JSON document**, deliberately ([`schema.ts`](../../src/db/schema.ts) §
   `glossary`) — and that comment already names the condition: *"if a reader ever edits or annotates
   one, that is the day this becomes a table"*.
2. **Find more terms recomputes and merges**, so a reader's entry could be merged away by a button
   two lines down the same panel.
3. **A shared article publishes the whole glossary blob**
   ([`public-reader.ts`](../../src/store/public-reader.ts)); the public DTO strips only
   `entry.lookup` ([`public-types.ts`](../../src/public-types.ts)). **A term the reader added would
   go out with an already-shared link.**

So v1 stores nothing, and the hint under the box says *"Not added to the list"* so the answer's
disappearance reads as the design. Persistence needs its own owner-scoped `reader_glossary_entries`
table and a decision about the public projection.

## Three refusals, not one — the `-X` lesson applied a day later

`[gl-ask-absent]` (nowhere in the piece → **Ask in chat**), `[gl-ask-part-word]` (the characters are
there but always inside a longer word → retype it as the piece writes it), `[gl-ask-no-prose]`
(nothing was searched, so nothing is claimed about the term). None names the term back at the reader:
it is in the box a line above, which is what turned a refusal into a denial last time.

## Believed after the tests were made to fail on purpose

Nineteen cases in [`tests/glossary-asked-term.test.ts`](../../tests/glossary-asked-term.test.ts),
matched on the bracketed code and never on the wording, and **four mutations watched red**: the two
409s collapsed into one, the no-prose branch removed, the reader's own string used as the quote, and
the ownership check moved after validation. Then driven in a real browser on a real article, with a
real model call: the singular found the plural, the answer quoted *criminals*, the refusal showed its
code, *Ask in chat* switched mode, and the list stayed at twenty terms.

## GPT Sol's review found three real things, and one of them was the same fault again

- **`[gl-ask-part-word]` claimed more than it had checked.** The draft said the characters were
  *"every time inside a longer word"*; `-bar` against a piece that says `foo-bar` is the
  counterexample. The sentence now says only what the boundary lookarounds tested — *a letter or a
  digit runs straight into them* — and a test pins it. This is the reported bug's own class caught
  one more time, in copy rather than in code.
- **A reply could land under a different term.** The box stays editable while the request is out, so
  an explanation of *attention head* could render beneath a box now reading *transformer*. Fixed
  with the generation `useOrderedRead` uses, bumped on every keystroke.
- **The route comment's claim that the job queue limited spend was false** — see the note below it.

It also caught the client-import guard the first draft tripped: `asked-term.ts` reaches the browser
and so must import nothing, and it was importing one number from `vocabulary.ts`. The eighty is now
written out in both, with a test keeping them equal.

## Left for Greg to rule on

- **Persistence**, above. It is a public-projection decision before it is a schema one.
- **There is no rate limit, quota or single-flight guard on this endpoint**, and there is none to
  reuse — the sibling `lookup` POST has none either, and the only limiter in `routes.ts` is the
  feedback form's hourly cap. GPT Sol's review called this the one thing it would block a public
  ship on: an owner with one article of their own can drive paid `explain` calls as fast as they can
  post, each of which may run up to eight web searches. Ownership decides *which* article, not *how
  many* requests, and this request never enters the job queue, so the concurrency limit of three
  does not touch it. **It is the shape of every paid request in `routes.ts`, not something this
  feature introduced** — which is why it is written down for a decision rather than patched here
  for one endpoint. The cheapest existing machinery is `inTurnOrder` (one ask at a time per
  article), but it is per *process* and so bounds nothing on a fleet; a real cap is a stored
  counter, which belongs with billing.
- **The Chat handoff is a mode switch and nothing more** — the composer is not pre-filled with the
  term. One prop's worth of work, not done.
