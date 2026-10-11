# Cited by finds a paper with no DOI by its title and author, at OpenAlex

Report `spya-vh0z7s` (SPIDERYARN-READING2-G8, -GB), Greg's; queue item qi-4rdhx39b; question
[q-hbg65m](../user-feedback/questions/q-hbg65m.md), answered from production as `spya-qne5cs`.
Session `fbvh0z7s-cited-by-openalex`, 2026-10-11. Follows
[261010n](261010n-reception-says-plainly-why-it-is-empty-and-finds-an-arxiv-paper-s-doi.md), which
gave an arXiv paper its DOI and asked Greg what to do for a piece that has none.

## What Greg said

> 1A
> 2C yes, use OpenAlex and/or other methods, with a careful check afterwards
>
> — Greg, 2026-10-11 (`spya-qne5cs`, replying to q-hbg65m)

1A: Reception and Claims stay two sub-modes, as built. Nothing to do.

2C, as the question put it: *"Ask OpenAlex by title and author when there is no DOI. Automatic, but
a title search can match the wrong work more often, so the check would have to be strict."*

## What happens today

`citersOf` ([src/citation-index.ts](../../src/citation-index.ts)) asks OpenAlex only with a DOI: the
article's own, or arXiv's from an arxiv.org address (`citersIdOf`). Anything else is `no-doi`, and
the panel says *"We could not list who cites this piece, because we have no DOI for it…"*, with a
Google Scholar link under it. Nothing is asked.

## What we will do

As revised after GPT Sol's plan review (verdict RETHINK; § GPT Sol's plan review below says what
changed and why).

### The search

When `citersIdOf` finds nothing, and the article has a distinctive title **and** at least one
author (a byline or `authors`), ask OpenAlex once, the address built with `URLSearchParams`:

```
works?search.title=<the title's words>&per_page=10&select=id,doi,display_name,publication_year,authorships&mailto=…
```

The title goes as its words only (lower-cased, by the same `tokens` the registry check uses, joined
by spaces and bounded to 300 characters), so punctuation and OpenAlex's upper-case `AND`/`OR`/`NOT`
cannot change the query. A search parameter rather than a `filter=`, so a comma cannot either.
Measured 2026-10-11: `search.title`, `filter=title.search:` and `filter=display_name.search:` are
the same query on OpenAlex's side (`x_query` names all three as `display_name.search`).

### The check, stricter than a DOI's

A DOI's record is corroborated by its whole title and one author, because the DOI itself is
evidence. A title search has no such evidence, so a candidate must pass all of:

1. **the whole title** is this article's (`registryIsThisArticle`, which also refuses a title too
   short to be distinctive);
2. **and a second fact**, either
   - **two or more** of OpenAlex's authors are among ours (each tested on its own with
     `registryAuthorIsOurs`), or
   - **one** is, **and** its year is within one of the article's (`publishedAt` or
     `publishedYear`);
3. **and it is the only one.** If two different OpenAlex works pass, nothing is matched: citation
   count is not evidence of identity.

A single-author piece with no year on record therefore never matches. That is the price of
strictness, and the Google Scholar link stays under the sentence.

**The year is never a veto on its own.** Measured 2026-10-11: the search returns Vaswani et al. as
W2626778328, the right work, with `publication_year` **2025**. All eight authors agree, so it
passes on 1+2a. Fifth in the same answer is a 2025 book chapter by J. M. Bishop with exactly the
same title, refused by the authors.

**No author, no search.** Greg's "an author and/or year" would allow title and year alone; for a
web page with no byline that matches any same-titled piece of that year. Such an article stays
`no-doi`, and nothing is asked.

### The list, by OpenAlex's own id

A match's `W…` id goes straight to the existing `works?filter=cites:` request. **No DOI hop**: the
DOI OpenAlex gives back is OpenAlex's own metadata (for Attention it is `10.65215/2q58a426`, not
arXiv's `10.48550/arxiv.1706.03762`), so asking about it would only repeat what OpenAlex already
said; and a work with no DOI at all can still be listed.

The list is cached in the existing `citation_index_lookups`, keyed `openalex:w<digits>` beside the
`doi:…` keys: one migration loosening that table's key check to accept either shape. Every later
read of the row is checked against its stored title and authors as today.

**The search itself is not cached** (Sol's F3 and F7): a cache keyed on titles and authors is not
anonymous, would outlive the article's deletion, and a wrong key hands one paper another's match.
Each opening of Reception on a no-DOI article with an author therefore spends one OpenAlex search.
Measured: $0.001 each, against an anonymous allowance of **$0.10 a day** (the
`x-ratelimit-limit-usd` header), shared with the DOI path. That is enough at today's readership; an
API key raises it tenfold, and is a queue entry (it is an `.env` and Vercel change, which this run
may not make). A per-article cache is the second entry, for when the allowance bites.

### What the reader sees

`CitersResult`'s `found` gains `via: "doi" | "title"` and `target: { openalexId, title }`, both
always present, so the panel can show what was matched and nothing has to be optional.

- **Found by title**: one line above the list, *"We had no DOI for this piece, so we matched it by
  its title and authors to this OpenAlex record:"* and the record's title, linked to
  `openalex.org/W…`. A wrong match is visible as one.
- **`no-match`**, a new outcome: *"We had no DOI for this piece, and searching OpenAlex by its
  title found no record we could be sure is this one, so we cannot list who cites it."* Not a
  claim that OpenAlex has none.
- `no-doi` keeps its sentence, for a piece with no author or no distinctive title, where nothing
  was asked.
- The search failing is `unavailable`, with *Try again*.

### The other places that have to hear

- `/privacy`, `CITERS_ABOUT`, and [privacy.md](../project/privacy.md): for an article with no DOI,
  OpenAlex is sent **the title's words** and our contact address. Not the authors, which are
  compared on our side, and not the body. `LAST_UPDATED` moves.
- `useCiters`'s and the route's comments, which say "costs nothing" and "two requests": now up to
  three, and the allowance is not money but is finite.
- `asCitersResult` validates `via`, `target` and `no-match`, rather than casting.
- [reception.md § Cited by](../project/reception.md), [sources.md](../project/sources.md),
  [bibliography.md](../project/bibliography.md) and the Sources help page where they say Cited by
  needs a DOI; `citation-index.ts`'s header diagram; the `CitersResult` comment.

## Stages

1. **Server**: migration and schema, the key type in the store, the search, its parser and the
   check in `citation-index.ts`, `no-match`, `via` and `target`. Tests red first: no author or a
   short title asks nothing; the Bishop case is refused; a 2025-year record with eight agreeing
   authors is accepted; one agreeing author needs the year; two passing works match nothing; the
   address carries no comma, pipe or upper-case operator and is bounded; a malformed id is
   skipped; the list is read from and written to the `openalex:` key.
2. **Client and words**: the panel's lines, `useCiters`, the privacy page and docs.

## The simpler options passed over

- **Adopting the DOI OpenAlex returns** (this plan's first draft): the table stays DOI-keyed and no
  migration is needed. Passed over: it validates nothing, and needs a DOI the work may not have.
- **A cache for the search**, keyed on a hash of title and authors: saves the allowance. Passed over
  for v1, for the privacy and correctness reasons above; queued.
- **Putting the match on the article's `meta.doi`**: weaker evidence than a DOI the page or a
  registry gave, and a read route would write the reader's article.

## Done is

Stage 1's tests red then green; `npm test`, `npm run typecheck`; GPT Sol's plan review before and
code review after; q-hbg65m closed; a note in `docs/user-feedback/`.

## GPT Sol's plan review

[261011q-plan-review-sol.md](261011q-plan-review-sol.md) (prompt:
[261011q-plan-review-prompt.md](261011q-plan-review-prompt.md)), `gpt-5.6-sol`, high, review
sandbox, exit 0. Verdict: RETHINK. Taken:

| | Finding | Taken as |
|---|---|---|
| F1 | title plus one author (even an initial) is too weak to discover an identifier; most-cited is not evidence | a second fact required (two authors, or one and the year); two passing works match nothing |
| F2 | the DOI hop re-checks OpenAlex against itself; Attention's returned DOI is not arXiv's | the `W` id is used directly |
| F3 | a title-and-author cache key can hand one paper another's match | no search cache |
| F4 | legacy filter syntax, `per-page` | `search.title` via `URLSearchParams`, `per_page`; the anonymous budget measured ($0.10/day) |
| F5 | a cached match whose DOI later fails | gone with the DOI hop and the search cache |
| F6 | "it has no DOI of its own" and "OpenAlex has no paper" overclaim; the match is invisible | the sentences rewritten; the matched record is shown and linked |
| F7 | the author names are not sent; the hash is not anonymous and survives deletion | the privacy text says title words only; no hash table |
| F8 | `CITERS_ABOUT`, `useCiters`, the route comment, `asCitersResult`, the tests | all in Stage 1 and 2 |

## GPT Sol's code review

[261011q-code-review-sol.md](261011q-code-review-sol.md) (prompt:
[261011q-code-review-prompt.md](261011q-code-review-prompt.md), diff:
[261011q-code-review.diff](261011q-code-review.diff)), `gpt-5.6-sol`, high, workspace-write, exit 0.
Verdict: LAND AFTER FIXES. Sol fixed five in place, and I read its diff:

- **C1 (P2)**: `Ashish Vaswani` and `A. Vaswani` in one record counted as two agreeing authors.
  Name variants of one person now count once; tests.
- **C2 (P2)**: the catch-all logged `errorFields`, whose message can carry the search address (and
  so the title) or a database parameter. Now only the key, outcome and time; a test.
- **C3 (P3)**: the client took any `target.openalexId`; now only a `W` id, and the matched-record
  link is built from it alone.
- **C4 (P3)**: loading the dependencies could throw out of `citersOf`; now `unavailable`.
- **C5 (P3)**: the matched-record line overclaimed, and the `unavailable` and `too-large` sentences
  named the wrong failure. Reworded; I then made its matched-record line plainer: *"We had no DOI
  for this piece, so we looked it up in OpenAlex by its title, and took this record because its
  title and two of its authors (or one author and the year) match:"*.

Sol could not run the Postgres suite in its sandbox; run here afterwards with the other touched
suites (349 passed) and `npm run typecheck`.
