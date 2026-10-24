The deterministic dateline reader is the right, simplest fix. The address fallback is not safe enough to write into `publishedAt` as designed.

1. **Blocker — an address date is not reliable publication evidence, and it suppresses stronger registry evidence.**

   Evidence: the plan accepts any `/YYYY/MM/DD/` route or segment beginning `YYYY-MM-DD`, while acknowledging that it may be a filing or draft date ([plan:58](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/docs/plans/261024a-a-web-page-with-no-date-tag-gets-its-publication-date-from-its-dateline-or-its-address.md:58>)). `realIsoDay` verifies only shape, calendar validity, and a 1500–2100 year ([src/bibliographic.ts:348](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/bibliographic.ts:348>)). Thus `/history/1969-07-20-moon-landing`, `/events/2026/10/24/conference`, or a dated archive silently become publication dates. Worse, the registry runs after extraction ([src/pipeline.ts:3323](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/pipeline.ts:3323>)) and fills a day only when `publishedAt` is absent ([src/article-registry.ts:253](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/article-registry.ts:253>)); a weak URL inference therefore defeats an agreeing Crossref/DataCite day.

   Concrete change: ship the dateline fallback only. That fixes the reported page. Defer address inference until it has distinct provenance and can be shown as “Estimated”, or apply it after registry enrichment only when neither a day nor year exists. Do not put an address-only guess into the existing field, whose contract is a publisher/registry claim ([src/types.ts:1823](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/types.ts:1823>)).

2. **Should — “the first few after the heading” is not a sound contract over `OpeningRecord[]`.**

   Evidence: a visible non-empty `<h1>` normally becomes record 1, as the existing test confirms ([tests/front-matter-authors.test.ts:86](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/tests/front-matter-authors.test.ts:86>)). With no `<h1>`, reading begins at the top of `article`, `main`, or `body` ([src/front-matter-authors.ts:203](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/front-matter-authors.ts:203>)); the records contain no element or scope provenance, only id, text, and marks ([src/front-matter-authors.ts:50](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/front-matter-authors.ts:50>)). Blindly dropping record 1 misses a no-`h1` dateline; scanning body records can mistake site header text for one.

   The arbitrary-segment rule is also too broad: `Conference | November 2, 2025` passes the proposed rule.

   Concrete change: expose structural provenance such as `tag`/`isMainHeading` and whether the scope was `article`, `main`, or body. Define an exact bounded count. Accept either a whole record that is exactly a date, or a date with a recognized `Published`/`Posted` label; do not accept an arbitrary date-only segment beside unrelated text. Add cases for ordinary, empty/hidden, and absent `<h1>`, including a body-only page header.

3. **Should — “not after the fetch” needs an explicit, stable clock.**

   Evidence: `runExtract` receives no fetch timestamp ([src/extract.ts:1306](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/extract.ts:1306>)) and currently creates `fetchedAt` near the end with a fresh `new Date()` ([src/extract.ts:1460](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/extract.ts:1460>)). The actual stage-1 timestamp already exists on `RawManifest` ([src/fetch.ts:239](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/fetch.ts:239>)). Without a seam, the same stored bytes can be rejected today and accepted after a retry tomorrow, and future-date tests depend on wall-clock time.

   Concrete change: pass the manifest’s `fetchedAt` into `runExtract`, or pass an explicit ceiling day/clock dependency. Use that same value for validation and make tests fix it.

4. **Should — deferring the matter bug is defensible only as a real tracked deferral, and the later fix must invalidate stored matter.**

   Evidence: the diagnosis is correct: `furniture` ignores block kind, so a short captioned media block passes ([src/matter.ts:789](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/matter.ts:789>)). Rebuilding the lost evaluation corpora is substantial and the project requires all three sets for a check change ([docs/project/front-and-back-matter.md:74](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/docs/project/front-and-back-matter.md:74>), [investigation:126](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/docs/investigations/261018b-front-and-back-matter-eval.md:126>)).

   However, “it goes in the queue” is not itself a deliverable. Also, the promise that the existing stub disappears requires bumping `MATTER_PROMPT_VERSION`; reads otherwise continue accepting the stored stretch ([src/matter-current.ts:20](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/matter-current.ts:20>), [src/matter-current.ts:83](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/matter-current.ts:83>)).

   Concrete change: create an actual dated queue item under the standing bug authority, naming the live defect, owner, fixture/regression test, three-set evaluation, and mandatory version bump. State plainly that the reported figure remains incorrectly folded until it lands. No question to Greg is needed: this is an evidence-check bug, not a product choice.

5. **Should — the test matrix needs independent negative and precedence controls.**

   Evidence: the proposed tests cover positive URL shapes and meta-over-dateline, but not the assumptions most likely to fail silently ([plan:110](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/docs/plans/261024a-a-web-page-with-no-date-tag-gets-its-publication-date-from-its-dateline-or-its-address.md:110>)). Existing publication-date tests deliberately use positive controls so absence cannot pass vacuously ([tests/publication-date.test.ts:104](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/tests/publication-date.test.ts:104>)).

   Concrete change: add red-first cases for no/empty `<h1>`, an event dateline, an arbitrary separated date, historical-subject and archive URLs, dateline-versus-address disagreement, and an agreeing registry date versus any retained address candidate. Assert that `publishedAt` and `publishedYear` never coexist.

The freshness analysis itself is sound: only Timeline’s generated artefact hashes `publishedAt` ([src/source-hash.ts:430](</var/tmp/spideryarn-worktrees/fbgapqbt-publication-date-from-the-page/src/source-hash.ts:430>)); other modes should remain current.

**Verdict: rework.**