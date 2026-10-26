Refuse Stage 1 as written: 4 established P1s, 2 P2s, no P0s.

### Findings

S1-F1 — P1 — The identity check can admit the wrong authors, then union their records

[`agreeingAuthors`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/citation-index.ts:538>) tests each OpenAlex author independently against the whole free-text byline. The underlying matcher can cross an author boundary, and [`areTwins`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/citation-index.ts:573>) then treats two such records as one work.

Executable counterexample:

- Article byline: `Jane Alice Smith, John Bob Jones`
- OpenAlex authors: `John Smith`, `Bob Jones`
- Same distinctive title, records dated 2020 and 2021

`titleMatchOf` returned a match with `W1` and `alsoHeldAs: ["W2"]`. Neither OpenAlex author list is the article’s author list. A single wrong record already passes; the new twin rule now unions multiple wrong records.

Suggested fix: replace the bag-of-byline-words check with one-to-one matching between distinct article authors and distinct OpenAlex authors, generalising `twoStructuredAuthorsAgree`. If only a byline exists, parse its author segments before matching rather than scanning across separators.

S1-F2 — P1 — The Since check can delete legitimate evidence using guessed years

[`pieceFacts`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/situate.ts:1049>) uses the planner’s model-written year when metadata has none, and accepts metadata years without an upper bound. [`sourceYear`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/situate.ts:1066>) interprets any standalone year in an arbitrary URL as the page’s publication year; [`notSinceSources`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/situate.ts:1087>) then removes it.

For example, `https://example.com/review-of-2020-study` is classified as a 2020 source. A review published in 2025 at that URL would be dropped from a finding about a 2023 piece. This directly contradicts the comment that a page about an earlier year is not treated as dating from that year. A mistaken planner year can cause the same loss when the article lacks metadata.

Suggested fix: destructively filter only when the piece has a bounded, code-owned publication year and the source has trustworthy structured date evidence. Retain arbitrary web URLs and skip enforcement when the piece year comes only from the planner.

S1-F3 — P1 — “Other editions” is inferred from relationships that do not prove an edition

[`titleIsAVersion`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/related-work.ts:688>) accepts any same-author work formed by adding or removing a subtitle. [`doiExtends`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/related-work.ts:698>) treats a lexical DOI prefix as an identifier relationship.

Consequently:

- A distinct paper such as `The Extended Mind: A New Theory`, by the same authors, is labelled an edition.
- An unrelated same-author work with DOI `10.x/foo.1` is labelled an edition of `10.x/foo`.

DOI suffixes are opaque; punctuation does not establish version lineage.

Suggested fix: require an actual registry relationship or an explicit reprint/translation/version marker alongside a sufficiently matching title. Put subtitle-only and DOI-prefix-only cases under the neutral “By the same authors” heading.

S1-F4 — P1 — The reserved query passes validation, but active search operators survive

The query does go through `validateQueries`, but [`SEARCH_OPERATOR`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/situate.ts:303>) is a partial blacklist. It omits operators such as `before:`, `after:`, boolean operators, and unary exclusions. Because [`pieceQuery`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/situate.ts:385>) places the parsed surname outside the quoted title, hostile byline metadata can inject them.

With byline `Mallory after:2030`, the accepted reserved query was:

```text
"A Distinctive Paper Title" after:2030
```

That violates S3’s promise that untrusted article metadata cannot steer an automatically executed search.

Suggested fix: whitelist the surname’s permitted characters and refuse anything else. If the broader claim remains that planner operators are stripped, validate against search grammar rather than maintaining a short operator list.

S1-F5 — P2 — The topic list is fetched eagerly, before the reader chooses it

Once the base count exceeds 1,000, [`citersOf`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/citation-index.ts:952>) calls `theTopicList` regardless of `opts.about`. The test explicitly expects title search, union list, and topic list on the first ordinary request.

It is not an external request on literally every open: the topic row is cached for seven days. It is nevertheless fetched on the first open and each stale refresh, while pressing the topic switch normally adds no request.

This remains within the privacy disclosure: the extra query contains OpenAlex IDs and OpenAlex’s own keyword, not additional article or reader text. It does spend allowance and latency for a view the reader may never select.

Suggested fix: expose topic availability/keyword with the base result, but fetch and cache the filtered list only for `about: "topic"`.

S1-F6 — P2 — Topic cache provenance is logged incorrectly

[`theTopicList`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/citation-index.ts:862>) returns no cache provenance. The final logging call uses the base list’s `listed.from` at [`citation-index.ts:962`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/citation-index.ts:962>).

Thus a cached base plus freshly fetched topic is logged as `from: "cache"`, and a stale topic fallback can also inherit the base’s provenance. That violates the logging contract’s requirement that diagnostic lines not claim the wrong source.

Suggested fix: have `theTopicList` return `{ result, from }` and pass its own `cache | openalex | stale` value to `done`.

### Checks and remaining conclusions

- The canonical union key, database shape, and `alsoHeldAs` Postgres round-trip otherwise look coherent.
- Stale topic data is served safely; only its logged provenance is wrong.
- `situate/2` is wired through generation, storage freshness, and tests correctly.
- The unsourced-work check matches the Stage 3 result: diagnostic only, not destructive.

Requested test run passed:

```text
Test Files  3 passed
Tests       184 passed
Duration    13.50s
```

No files were changed.