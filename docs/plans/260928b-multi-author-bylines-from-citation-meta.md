# Multi-author bylines from the page's citation metadata

Greg, 2026-09-28:

> We tried importing https://www.nature.com/articles/s41597-021-01033-3?error=cookies_not_supported&code=b992919b-1aad-47e6-9e3d-7bf2f22ab2c6
> and it seemed to screw up the authors import (i.e. only noticed Uri Hasson) - try reproducing and
> address (and improve our tests)

Postmortem: [260928a-a-library-field-that-holds-one-value-for-a-list-keeps-one.md](../postmortems/260928a-a-library-field-that-holds-one-value-for-a-list-keeps-one.md).

## What is wrong

`meta.byline` is Readability's `byline`, tidied (`src/extract.ts`, `runExtract`). Readability 0.6.0
builds it in `_getArticleMetadata` from, in order: JSON-LD `author` (top-level or `@graph` only),
then a `name → content` map of `<meta>` tags (`dc:creator`, `dcterm:creator`, `author`, …), then
the DOM (`_checkByline`). The meta map is **one value per name, last write wins**
(`values[name] = content.trim()`), so a page that repeats `<meta name="dc.creator">` once per author
keeps only the last author. `citation_author` — the Highwire/Google Scholar tag every scholarly
publisher emits once per author — is not read at all.

Reproduced on saved pages, 2026-09-28 (`readArticle(...).article.byline`):

| Page | Authors on the page | What we stored |
| --- | --- | --- |
| Nature, s41597-021-01033-3 (Greg's) | 25 `citation_author`, 25 `dc.creator`; JSON-LD under `mainEntity` | `Hasson, Uri` (last) |
| Nature, s41586-021-03819-2 (AlphaFold) | 34 / 34 | `Hassabis, Demis` (last) |
| PLOS ONE 10.1371/journal.pone.0285120 | 6 `citation_author` | `Karin Tajima,` (DOM, first) |
| arXiv 1706.03762 | 8 `citation_author` | `[Submitted on 12 Jun 2017 (v1), …]` (DOM, a dateline) |
| Frontiers fpsyg.2020.01196 | 6 `citation_author`, top-level JSON-LD | correct (JSON-LD) |

Nature's JSON-LD is `{"@type":"WebPage","mainEntity":{"@type":"ScholarlyArticle","author":[…]}}`,
which Readability's `_getJSONLD` skips because the top-level type is not an article type.

**The query string is a red herring.** `?error=cookies_not_supported&code=…` is what Nature
appends after its cookie-check redirect; a clean URL redirects to the same thing and the bytes are
the same article page (1,017,780 bytes both ways). Nothing to strip.

## The fix

A small pure module, `src/meta-authors.ts`, read on the document **before** Readability mutates
it (in `readingArm`), returned alongside the article, and preferred by `runExtract` when it has an
answer:

1. **`citation_author`, every value, in document order, when there is at least one.** It is the
   page declaring its authors for indexing, it is present on every scholarly page above, and it
   is the one that fixes arXiv (where Readability's fallback is a dateline) as well as the rest.
2. Otherwise **a repeated `dc.creator` / `dcterms.creator` / `dcterm.creator`** (dot or colon),
   when there are two or more values — exactly the case Readability collapses. A single value is
   left to Readability, which already reads it correctly.
3. **`chooseByline` keeps Readability's byline when it already names every one of those authors**
   (each full name appears in it as consecutive words, case and diacritics folded; a surname alone
   is not enough, since `May` can be in a dateline, Sol's code review), and uses the declared list otherwise.
   So Frontiers, whose JSON-LD Readability reads in full, stores exactly what it stored before, and
   so does a page with one `citation_author` beside a complete JSON-LD list. *Changed after the
   plan review (Sol F1): the first draft let a single `citation_author` win outright.*
4. No tags at all: Readability's byline, unchanged.

Names are put in natural order **for the whole list or not at all**: only when every name has the
`Surname, Given` shape (one comma, at most three words either side, no `Jr.`/`III` after the
comma, no organisation word such as `University` or `Consortium`). One name that does not means the publisher's order is kept for all of them. *Changed after
Sol F2, who found `John Smith, Jr.` → `Jr. John Smith`.* Case-insensitive duplicates are dropped,
and the list is joined with **`"; "`**.

**Why `"; "` rather than `", "`**: `authorKeys` in `src/referee-candidates.ts` (Referee mode's
own-author exclusion) splits people on `;` and decides a comma per segment, and it reads a
two-part comma segment as `Surname, Given`. `"Jane Doe, John Smith"` would be read as one person
named "John Smith Jane Doe". The semicolon is unambiguous for it, for the model prompts that see
`BY:`, and for a reader.

**Not in scope**: nested JSON-LD. Every page above that has it also has `citation_author`; rule 1
covers it. Nor the display of a 34-name byline — `meta.byline` was always free text.

**The simpler option passed over**: patching Readability's `values[name]` to accumulate. That is
a vendored-library fork to maintain, and it would still miss `citation_author` and arXiv.

## Tests

- `tests/meta-authors.test.ts`: unit cases for each source (citation_author in both name orders,
  repeated dc.creator, single dc.creator left alone, duplicates, empty content, none at all).
- A trimmed fixture per publisher — only the `<head>` metadata that matters plus our own filler
  prose, no article text — under `tests/fixtures/bylines/`: Nature (Greg's page), PLOS, arXiv.
  Each goes through `runExtract` and must store every author; watched red first against current
  code.

## Fixing Greg's copy

The Metadata page's reset (plan 260928a) forces `extract` and re-reads the HTML we stored, without
fetching again, and `runExtract` rebuilds `meta` every run, so after deploy a reset fixes it.
Pasting the same URL again is the less certain route: `slugForRetry` (src/jobs.ts) adopts the
article already on the shelf, and whether that re-runs `extract` was not traced. Pasting the URL with
a *different* `code=` value, which is what Nature hands out on each redirect, is not the same
`urlKey` and makes a second card. Use the reset.
