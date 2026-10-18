No P0 findings. I found seven P1s and two P2s.

## Findings

**F1 — P1 — The landing design does not identify or observe the band’s actual scroller.**  
[plan:60](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:60), [item-focus.ts:93](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/web/item-focus.ts:93), [flash.ts:336](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/web/flash.ts:336)

`row.scrollIntoView({block:"center"})` can scroll every scrollable ancestor, including the viewport; the repository already calls that out in [skim-panel.test.tsx:2004](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/tests/skim-panel.test.tsx:2004). Bibliography’s scroller is the surrounding `.tl-scroll`, while the hook receives the inner `<ol>`; the other callers have different scroller shapes. Also, `scrollToAndFlash` observes `window` scrolling, not `.tl-scroll`, so it cannot supply the promised “flash after the band scroll settles.”

Concrete failure: halfway down an article, opening Sources centres the row in the fixed band but also changes the document scroll position underneath it; closing the covering mobile band exposes a different prose position. Alternatively, the flash begins while the inner scroller is still moving.

Pass the actual scroller to the hook, centre it directly, and observe that scroller’s `scroll`/`scrollend` before flashing—or make the move explicitly instant. The browser test should assert the row’s geometry, the scroller’s `scrollTop`, and unchanged `window.scrollY`, not only the `scrollIntoView` arguments and CSS class. The threshold-lowering sequence itself is sound: `drawn:false` delays the shared effect until the later render contains the row.

**F2 — P2 — A band-row flash will cancel any visible prose flash.**  
[flash.ts:126](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/web/flash.ts:126), [flash.ts:252](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/web/flash.ts:252), [plan:60](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:60)

`flashElement` and prose flashes share the single module-level `live`; every `wash` calls `stop()`. On desktop, a reader can follow a citation jump, open its hover card during the 1.2/2.4-second prose wash, then press *Open in Sources*: the row flash immediately removes the prose flash. A held mobile prose flash is different—`pending` is not cleared and will still play when the band closes.

This replacement may be the desired rule, but the plan should explicitly accept it. If both destinations should remain marked on desktop, element and prose flashes need separate live slots.

**F3 — P1 — The spike cannot currently decide whether the result is “decent enough.”**  
[plan:78](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:78), [plan:91](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:91)

Three conveniently selected articles do not expose the main coverage failures: DOI versus arXiv versus article URL versus title-only identity, books and reports, incomplete references, duplicate titles, and non-paper essay citations. Nor are pass thresholds defined for coverage, informative blurbs, unsupported claims, wrong-work rate, cost, or latency.

The Opus judge can assess whether prose follows the supplied evidence, but cannot establish that the evidence belongs to the cited work without independent identity truth. Concrete failure: Haiku accurately paraphrases an abstract for the wrong same-title paper and Opus labels it “supported.”

Use a citation-stratified sample, predeclare gates, manually establish identity for every ambiguous/wrong-work case, and calibrate the judge against blinded human labels. Separate the production-arm ledger rows from judge calls so the reported per-article cost does not include the evaluation machinery.

**F4 — P1 — Arm A assumes OpenAlex lookup machinery that does not exist and omits important evidence arms.**  
[plan:81](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:81), [related-work.ts:341](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/related-work.ts:341), [bibliographic.ts:397](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/bibliographic.ts:397)

`related-work.ts` has one semantic related-work search, not DOI/arXiv/title lookup for each citation, and its parser retains only a 400-character abstract opening. The existing DOI registry path already calls Crossref/DataCite, but `parseCrossref` discards Crossref’s abstract field.

The spike should compare a real cascade:

- Crossref abstract for an already-confirmed DOI; Crossref exposes abstract-bearing records through its API. [Crossref REST documentation](https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/)
- arXiv’s own `summary` for an exact arXiv ID, as already proposed. [arXiv API manual](https://github.com/arXiv/arxiv-docs/blob/develop/source/help/api/user-manual.md)
- OpenAlex by stable identifier before any title search.
- Semantic Scholar abstract and its model-written TLDR as separate evidence types, not interchangeable provenance. Its API supports requested abstract fields and batch paper lookup. [Semantic Scholar API](https://api.semanticscholar.org/api-docs/)
- Unpaywall only as an OA-location arm: it supplies landing/PDF locations, not an abstract. Using it means fetching and classifying a copy of the work, a materially different experiment. [Unpaywall data format](https://unpaywall.org/data-format)

Also include a zero-model baseline—such as a bounded abstract opening where redistribution terms permit—so the spike measures whether Haiku adds enough value to justify its new failure mode.

**F5 — P1 — `pageNamesTitle` is not strong enough to claim a web result is the work.**  
[plan:109](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:109), [citation-lookup.ts:312](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/citation-lookup.ts:312)

The code itself documents `resultIsTheWork` as stricter than `pageNamesTitle`. The latter is sufficient for the old “page matching its title” claim, not for treating the page as authoritative evidence about the work.

Concrete failure: a correction, review, bibliography page, or secondary summary includes the paper’s title, passes `pageNamesTitle`, and supplies the row’s blurb. The UI then presents somebody else’s description as a quick account of the cited work.

Use `resultIsTheWork` or a stronger identifier-based rule, reject update/supplement/review objects, and separately classify primary abstract/full work versus secondary discussion. “Primary/authoritative” needs a code-enforced acceptance rule, not only prompt wording.

**F6 — P1 — Batched generation lacks a runtime faithfulness boundary and widens prompt-injection impact.**  
[plan:83](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:83), [citation-lookup.ts:42](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/citation-lookup.ts:42)

Abstracts and search extracts are stranger-controlled text. In one whole-list batch, an instruction embedded in one abstract can influence every work’s output or cause cross-work attribution. For provider web search, the repository already records that injection is residual because the model sees extracts before application code can fence them.

Require structured output keyed by application-supplied opaque indices, fence every evidence item as untrusted data, and require a supporting quotation/span for each blurb that code verifies against that item’s evidence. A failed quote, duplicate/missing index, or cross-item reference should produce no blurb. The call has no tools, limiting consequences, but the displayed sentence still needs this verification boundary.

**F7 — P1 — The storage fingerprint does not cover what made the blurb, and the claimed orphan protection is unclear.**  
[plan:100](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:100), [citation-lookup.ts:155](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/citation-lookup.ts:155), [schema.ts:5264](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/db/schema.ts:5264)

“The bibliography’s hash” is unspecified. `sourceHash` fingerprints article input, not the bibliography prompt/version, exact work identity, selected evidence, or blurb prompt. Including a changing hash in the primary key also creates old unreachable rows rather than preventing orphans.

Mirror the existing lookup design: key the row by `(article_id, entry_id)`, then attach it only while a recomputed context fingerprint matches the exact citation identity, source kind/identifier, prompt version and requested model; keep a separate evidence hash and supporting span. Store the authoritative source’s identifier as well as its URL.

Do not permanently conflate `null` with every failure. Concrete failure: the first request meets a temporary OpenAlex/Haiku outage, stores “no blurb,” and that work is never attempted again. Transient failure, confirmed no evidence, model decline, and unsafe/unsupported output need distinct states; only terminal negatives should be cached, with a refresh policy.

**F8 — P1 — The projected web-search price is not a production cost control.**  
[plan:85](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:85), [ai-gateway.md:418](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/project/ai-gateway.md:418), [web-search-subagent.ts:4](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/web-search-subagent.ts:4)

“One search” is prompt intent, not an enforceable bound. The current subagent records that two of six calls searched more than once; the gateway documents a 36-search call despite a result cap. The cited investigation explicitly says six queries are insufficient to quote a rate, yet the plan extrapolates its median to forty works.

The spike must report actual `webSearches` per work and per article, including p95/max and retries. The build needs an owner/global allowance, reservation before calls, maximum works and searches budget, bounded concurrency, deadlines, and deduplication. Until that exists, web fallback should be limited to the clicked work; otherwise one ordinary forty-citation article can exceed the intended few cents before ledger accounting reports it.

The spike’s three bibliographies should also be explicitly public/test articles. “Reads production” understates that the experiment then sends every cited title to new external services; a private referee upload’s bibliography must not become the test fixture merely because the database read is permitted.

**F9 — P2 — The reader-facing provenance and governing docs need the new exception stated precisely.**  
[plan:70](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:70), [plan:104](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md:104), [bibliography.md:191](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/docs/project/bibliography.md:191), [BibliographyPanel.tsx:933](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/web/BibliographyPanel.tsx:933)

“From a web search” does not satisfy the report’s request to distinguish an abstract, the article itself, and what somebody else said. Each row should say exactly what was read: e.g. abstract metadata, a search extract from the work’s page, or a secondary page. The list-wide “we have read none” text must change once some rows have evidence, and moving it into `(i)` must preserve the existing `showListReadNote` condition; otherwise it appears when no visible row relies on it.

This is a legitimate newer, labelled exception to the October 3 rule, not a contradiction: that rule removed a model paraphrase of the citing paragraph, whereas this uses newly fetched evidence. Stage 3 should explicitly update `bibliography.md` and `sources.md` with Greg’s newer quote and the provenance boundary so a later maintainer does not “correct” one side back to the other.

## Simpler high-value version

Land Stage 1 with an explicitly controlled band scroller. For blurbs, first try exact-identifier abstracts and compare Haiku against a no-model, bounded abstract extract. Ship abstract-only coverage if it is useful enough; search only the work the reader clicked when no verified abstract exists. That captures most of the value without forty independently billed searches, broad wrong-page matching, or a new whole-bibliography web-search job.

**Verdict: proceed with changes**