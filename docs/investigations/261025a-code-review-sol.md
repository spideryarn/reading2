# Code review

## Findings

- **Medium — `src/citation-index.ts:381` (fixed): the title exception trusted an
  arXiv-shaped stored DOI without independent evidence that it belonged to this
  article.** An article at a different arXiv address, or a later paper/blog post
  carrying an earlier paper's DOI, was accepted whenever two authors overlapped.
  That is exactly the header's failure: the newer article could receive the
  older article's citers. The exception now requires the article's own
  `arxiv.org` address to name the same DOI. A missing, non-arXiv or different
  arXiv address keeps the title rule.

- **Medium — `src/citation-index.ts:427` (fixed): `agreeingAuthors >= 2` did not
  prove that two article authors agreed.** `registryAuthorIsOurs` searches the
  whole byline existentially. Thus the single author `J. Smith Jones` matched
  both OpenAlex's `John Smith` and `Jane Jones`; a two-person byline could also
  be crossed into `Robert Butlin` and `Patrick Long`. The earlier duplicate
  check only proved that the two OpenAlex strings looked different. The
  title-free branch now requires a one-to-one match between two distinct
  OpenAlex names and two distinct structured article-author entries. Duplicate
  spelling and initial variants count once. A byline alone cannot supply this
  stronger evidence; that conservative limit is appropriate when the title supplies no
  evidence, and the affected Butlin paper has structured registry authors.

- **Medium — `tests/citation-index.test.ts:404` (fixed): the original test was a
  real positive test, including a cache hit, but its negatives were not enough
  to defend the new identity boundary.** It did not cover an absent/different
  arXiv address, a later page carrying an older DOI, a single author matching
  two names, matches recombined across author boundaries, duplicate spellings,
  or the stale fallback. Those cases are now explicit. The new safety tests
  failed against the reviewed implementation before the fixes and pass now.

- **Low — `src/situate-citers.ts:9` (reported, not changed because it is outside
  the allowed edit scope): the header comment is stale.** It says a DOI record
  must carry the article's title and an author, but `confirmedWorkOf` now also
  has the bounded arXiv-address/two-structured-author route.

## Downstream title check

No runtime use will expose OpenAlex's wrong target title on this DOI route.
`src/situate-citers.ts:106` uses only `confirmed.target.openalexId`;
`src/situate.ts:460` prompts with the article's own `opts.meta.title`; and
`src/web/ReceptionAndClaimsPanel.tsx:1853-1867` renders `found.target.title` only
when `via === "title"`. An arXiv DOI lookup has `via === "doi"`.

## What I changed

- Bound the arXiv title exception to the DOI independently named by the
  article's own arXiv address.
- Required two distinct structured article authors to match two distinct
  OpenAlex authors, conservatively deduplicating initials and spelling variants.
- Expanded the focused tests across fresh, cache and stale paths and all the
  negative identity cases above; kept every non-arXiv DOI on the title rule.
- Updated the in-scope `citation-index.ts` comments to describe the narrower
  rule.

## Checks

- `npx vitest run tests/citation-index.test.ts` — **pass**, 65 tests.
- `npx biome lint src/citation-index.ts tests/citation-index.test.ts` — **pass**.
- `git diff --check` — **pass**.
- `node --import tsx scripts/typecheck.ts` — every TypeScript project compiled;
  the final coverage check failed only because the unrelated untracked
  `scripts/spikes/.tmp-grep.ts` is outside every tsconfig.
- Direct `tsc --noEmit` runs for the root and test projects — **pass**.
- `npm test` — could not start the full suite because the shared local Postgres
  was unavailable (`connect EPERM 127.0.0.1:54362`). A separate unit-lane run
  was stopped after unrelated sandbox failures in `tests/run-codex.test.ts`.
