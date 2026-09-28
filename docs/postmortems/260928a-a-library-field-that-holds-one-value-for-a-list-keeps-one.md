# A library field that holds one value for a list keeps one

Greg, 2026-09-28:

> We tried importing https://www.nature.com/articles/s41597-021-01033-3?error=cookies_not_supported&code=b992919b-1aad-47e6-9e3d-7bf2f22ab2c6
> and it seemed to screw up the authors import (i.e. only noticed Uri Hasson) - try reproducing and
> address (and improve our tests)

Plan and evidence: [260928b-multi-author-bylines-from-citation-meta.md](../plans/260928b-multi-author-bylines-from-citation-meta.md).

## What happened

The paper has 25 authors. Its byline was stored as "Hasson, Uri", the last of them. The same
fault, checked the same day on saved pages: Nature's AlphaFold paper (34 authors) stored its last
author, PLOS ONE its first, and arXiv stored its own "[Submitted on 12 Jun 2017 …]" dateline.
Nothing errored, and a one-name byline looks exactly like a real single-author byline.

The query string was not involved. `?error=cookies_not_supported&code=…` is added by Nature's own
cookie-check redirect, and the page behind it is the full article either way.

## The root cause

`meta.byline` has been Readability's `byline` since the first commit (`cd7fc572`, 2026-08-24,
"Initial commit: extraction prototype"), later tidied of whitespace but never questioned as a
source. Readability's byline is one string, built in `_getArticleMetadata` from the first of:
JSON-LD `author` (read only at the top level or in `@graph`), then a map of `<meta>` tags, then
the DOM. That map is `values[name] = content`: **one slot per tag name, and each repeat
overwrites the one before.** Scholarly publishers repeat `dc.creator` once per author, so the last
author wins. `citation_author`, the Google Scholar tag every one of them emits per author, is not
in Readability's list at all. When the meta map had nothing, the DOM heuristic picked whatever
element had "author" or "dateline" in its class: PLOS's first author link, arXiv's dateline.

Nature does ship a complete JSON-LD author list, but nested under a `WebPage`'s `mainEntity`,
which Readability skips.

## The class: a library field that holds one value for a list keeps one

We asked a dependency for a **scalar** (`byline: string`) and the thing in the world is a
**list**. Somewhere inside, the library has to reduce many to one, and it does so silently: last
wins, first wins, or a heuristic picks one. The output has the right type and a plausible value,
so no check notices. The same shape: a `Map` or object keyed by a name that can repeat (HTTP
headers, query parameters, `<meta>` tags, form fields), `querySelector` where there can be many
matches, `.find` where the data can hold more than one.

It hides well because the one-value case is the common case in the corpus you test against. News
pages have one author, so every byline test passed on news pages.

## The fix

Shipped: [`src/meta-authors.ts`](../../src/meta-authors.ts) reads every `citation_author` (or a
repeated `dc.creator`) from the document before Readability mutates it. `runExtract` keeps
Readability's byline if it already names each of those authors, and otherwise stores the full list
joined with `"; "`. Pages with none of these tags are untouched. Tests:
[`tests/meta-authors.test.ts`](../../tests/meta-authors.test.ts), with trimmed fixtures of the
Nature, PLOS and arXiv pages under `tests/fixtures/bylines/`. Each of them stored the wrong byline
before the fix and was watched red.

Right for the long term: store authors as a **list** (`meta.authors: string[]`) and derive the
display byline from it. Referee mode's `authorKeys` then would not have to split a string that
was joined a moment earlier, and a "Surname, Given" name would not need guessing at. That is a
schema and DTO change across the store, export and public reader. It is worth doing when a second
feature needs authors as people rather than as a line of text, not before.

## What would have caught it, ranked by ease against value

1. **For every field taken from a dependency, write one test with the plural case**: two authors,
   two values for the header, two matches. Cheap, and it is the test this bug lacked. Done here for
   the byline: three publisher fixtures plus a unit test for each metadata source.
2. **When a stage takes a scalar from a library, read how the library chose it.** Five minutes in
   `Readability.js` shows the `values[name] =` line. Stated as a habit in
   [content-extraction.md § The byline](../project/content-extraction.md#the-byline-and-the-authors-readability-drops)
   for this stage.
3. **Include scholarly pages in the extraction eval corpus and score the byline.** Valuable,
   because the corpus is where the plural case would have shown up, but the evals score body text,
   not metadata. Scoring metadata is its own project. Not done.
4. Patch Readability to accumulate repeated meta values: rejected. It is a vendored fork to
   maintain, and it would still miss `citation_author` and the arXiv dateline.
