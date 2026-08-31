# Review: the Quotes mode as built

You reviewed the **plan** for this on 2026-08-31 and found two blockers. This is
the **code review** — the house rule is to weight this one higher than the plan
review, because a plan-stage review reads prose and cannot find a handler that
writes one field and then rejects the request.

Repository: /Users/greg/Dropbox/dev/experim/spideryarn2

## What you found last time, and what I did about it

Read `docs/plans/quotes-mode-review-sol.md` — your own review — first. Then check
each of these against the code, because **the point of this pass is to find where
I fixed the symptom and not the disease.**

1. **"Found in the article" ≠ "written by the author"** (your blocker 1).
   Added `authorVoice` in `src/quotes.ts`: refuses a `kind: "quote"` block, and
   refuses a span *wholly* enclosed in quotation marks. Counted separately as
   `dropped.otherVoice`, never folded into `unfound`. The product promise was
   weakened from "the author's own words" to "verbatim passages from this
   article" and `docs/project/quotes.md § Whose words these are` says out loud
   what the machine cannot prove. Ginsberg is a regression test.
   Quotes was added to `tests/block-policy-prompts.test.ts`.

2. **`findQuote` accepts altered text and the plan stored the altered version**
   (your blocker 2). Two changes: `findQuote` gained a fourth argument
   `passes: "forgiving" | "spaced"` (default unchanged, so no existing caller
   moved), and `locate` passes `"spaced"`; and `place` now stores
   `block.text.slice(span.start, span.end)` — the article's characters, never the
   model's string. I reproduced your `fall a part` case before fixing it and it
   is a test.
   `Quotes.discarded` now rides on the artefact and the panel shows a sentence.

3. **The default contradicted Greg.** `?rank=` now defaults to `document`.

4. **The `max` slider inherited false promises.** `PROMOTE_BAR` is 0.70 with
   `BAR_STEP` 0.05, documented as a guess with no measurement. The "hard right
   promotes exactly one" claim is gone and replaced with "all the top-scored
   quotes" — I did **not** implement your suggestion of slider stops at distinct
   observed scores. Tell me if that is a mistake.

5. **The cache saving was theoretical.** Corrected to "cache-compatible" in three
   places; the stage still uses `medium` + `text`.

6. **Missing seams.** `/api/quotes/` added to `CACHEABLE`; `quotes` added to the
   store inventories; sanitiser bumped 3 → 4 reserving `hit`, `data-hit`,
   `data-hues`, with a test.

7. **Tooltip/touch.** A separate ⓘ button beside the row (never nested), with a
   **controlled** `Tooltip` so hover and focus open it transiently and a tap
   pins it. I corrected the plan's wrong claim that there is no keyboard route.

## Read, in this order

1. `docs/plans/quotes-mode-review-sol.md` — your own findings.
2. `src/quotes.ts` — the whole stage. `locate`, `authorVoice`, `place`,
   `dedupeOverlaps`, `buildQuotes`, `inDocumentOrder`, `idsByText`, `SYSTEM`,
   `renderPrompt`, `generateQuotes`.
3. `src/quote-match.ts` — the `passes` argument and its docstring.
4. `tests/quotes.test.ts` — what I claim to have pinned.
5. `src/web/QuotesPanel.tsx` — `priorityOf`, `countAbove`, `canPrioritise`,
   `barMax`, `splitsOnBar`, `effectiveRank`, `barNote`, `discardedNote`,
   `rankQuotes`, `groupQuotes`, `rowScores`, and the `QuoteRow` / `BarSlider`
   components.
6. `src/web/useQuotes.ts`, `useQuotesMode` + `QuotesBand` in `src/web/App.tsx`,
   `resolveQuote` in `src/web/search-hits.ts`.
7. `src/pipeline.ts` § `STEPS.quotes`, `src/api.ts` § `loadQuotes`,
   `src/store/pg.ts` § `loadQuotes` and the `quotes` case in `isCurrent`.
8. `docs/project/quotes.md`.

**`src/pipeline.ts` and `src/store/pg.ts` also contain another agent's
uncommitted migration work.** Ignore anything about `blocksMatchTheirHtml`,
`canonicalBlock`, `articleWithIdsFingerprint`, `CITED_FINGERPRINT_COLUMNS` or
`ImportContradictsPipelineRun` — not mine, already under review elsewhere.

## What I most want you to attack

### 1. Is the safety property actually closed now?

Try to get words in front of a reader that the author did not write.

- `place` slices `block.text` by `span`. Is `Span.end` from `endOf` correct at
  every boundary — a match ending on a collapsed whitespace run, a match at the
  very end of a block, a match whose last character is a folded dash? Construct a
  slice that is off by one, or that ends mid-word.
- `authorVoice` reads `block.text` either side of the span. What gets past
  `OPENERS`/`CLOSERS`? I deliberately excluded apostrophes (a `'…'` sentence is
  more often emphasis than attribution) — is that the right trade, and what is
  the concrete case where it is wrong?
- `locate` returns the **first** block whose text contains the words. With
  `MIN_QUOTE_CHARS = 30` and `"spaced"`, can a real article still produce a wrong
  location? Note quotes are deduped on span overlap *after* location, so a wrong
  block also means a wrong overlap check.
- `generateQuotes` passes `evidence` to `articleText` **and** to `buildQuotes`
  as one variable. Is there any path where those diverge?

### 2. `discarded` on the artefact

`Quotes.discarded` is `{...opts.dropped}` taken inside `buildQuotes`. Is it
complete at that moment — does `overCap` get counted before the copy? Does the
panel's `discardedNote` say anything that could be false, and is it right that it
names only `unfound` and `otherVoice`?

Also: this is a new required field on a stored artefact. What happens to an
artefact written before it existed? (There are none in production — this stage
has never run — but the read path and `ArtifactStore`'s validator both see it.)

### 3. The panel's pure functions

`priorityOf`/`countAbove`/`barMax`/`splitsOnBar`/`groupQuotes`/`rankQuotes`/
`rowScores`/`effectiveRank`/`barNote` are the glossary's set with `max`
substituted. **I did not write a test file for them** — `tests/quotes.test.ts`
covers only the stage. That is a gap I am aware of and I would like you to tell
me which of them is most likely to be wrong, so the tests I add are the ones that
matter rather than nine that all pass.

In particular: is `barMax` correct when every quote scores 0? When one quote has
scores and the rest have none? Is `effectiveRank` reachable in a state where the
`RankBar` shows `prioritised` pressed but the list is in document order?

### 4. `resolveQuote` and the mark in the prose

The stored `text` is now the article's own characters, and the client re-finds it
in the *rendered* text with the forgiving passes. Is the `start` disambiguator
still meaningful across that change — it is an offset into `block.text`, and the
client compares it in rendered space? (`nearestIndex` maps back before comparing,
but I want that checked rather than assumed.)

`useQuotesMode` uses `slot: 0` for every quote. Only one can be selected, so no
two lanes coexist — is that actually true given `passages` in `App.tsx` switches
on `mode`, and could a mode change leave a quote's mark drawn under another
mode's state?

### 5. The prompt

`SYSTEM` in `src/quotes.ts`. Two things: does the verbatim instruction actually
carry, given the model is shown `articleText` (no ids) and asked to copy from it;
and is the `reason` field's ban on the describes-the-page register strong enough,
given the glossary's lesson that a ban relocates a register rather than deleting
one? Where would it relocate to here?

### 6. Anything else

Especially: something that reports success while doing nothing, and anything in
the wiring (route, store, DTO, offline, visitor projection) that would fail in
production and not in the tests. `data/writes/quotes.json` does not exist —
nothing has run this stage — so tell me which of my tests are passing vacuously.

## What a useful answer looks like

Findings, most important first. For each: **what breaks, the concrete input or
sequence that breaks it, and what to do instead.** Four I must act on beats twenty
I must triage. Say plainly if something is fine.
