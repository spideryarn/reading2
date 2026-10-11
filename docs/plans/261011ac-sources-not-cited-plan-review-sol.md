The OpenAlex/no-model approach is a good ease/value v1, but the privacy, exclusion, and owner-only UI contracts need tightening first.

- **F1 — P1: The request sends more article text than the current privacy promise permits.**  
  Evidence: the plan sends the title and opening automatically when the panel appears (`docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md:32-34,74-79`), while the privacy page promises OpenAlex receives only a DOI or title and “never the rest of the article’s text” (`src/web/PrivacyPage.tsx:418-422`; `docs/project/privacy.md:683-697`). This matters especially for confidential manuscripts.  
  Fix: use the measured input—title plus a bounded abstract—rather than an unspecified opening; fall back to title-only or `no-query`, not arbitrary body prose. Update `PrivacyPage`, `privacy.md`, `LAST_UPDATED`, and `privacy-page.test.ts` before release, and say in the chip card that opening the view sends those words to OpenAlex.

- **F2 — P1: A raw SHA-256 query key is pseudonymous, not anonymous or safely ownerless.**  
  Evidence: the plan calls the hash anonymous and globally shareable (`docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md:60-66`), but the existing OpenAlex implementation explicitly refuses a cache keyed from title/author content as “neither anonymous nor safe to share between articles” (`src/citation-index.ts:602-604`). A stable hash permits equality correlation and offline guessing from public title/opening corpora, survives article deletion, and cannot be scoped to an owner.  
  Fix: for v1, use the simpler article- or revision-scoped cache with a cascading foreign key and a versioned input fingerprint. Never log that fingerprint. If cross-owner sharing later proves valuable, use a secret-keyed HMAC and document its deletion and correlation properties; do not call it anonymous.

- **F3 — P1: The proposed exclusion matcher is not sound enough for the feature’s central claim.**  
  Evidence: the matcher is specified at `docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md:39-46`. A `CitedWork.key` is not necessarily an identifier: it may be `url:` or `work:<title>|<author>|<year>` (`src/types.ts:5032-5036`; `src/bibliography.ts:1432-1464`). Titles are capped at 120 characters and entries at 400 (`src/types.ts:5037-5038,5054-5066`). Bibliography can also mark an identifier as conflicting with the cited work (`src/types.ts:5117-5125,5165-5167`).  
  Likely false “not cited” rows: title/subtitle or punctuation variants; a title truncated to 120 characters; arXiv ID versus `10.48550/arxiv.…`; preprint versus proceedings DOI; author-year-only rows; a cited work omitted by Bibliography extraction; and PDF reference entries not represented in blocks. Likely false exclusions: generic or colliding titles found as substrings; a work merely discussed in prose; an incorrect DOI already marked `registry.kind === "conflict"`; and another paper sharing the article’s title.  
  Fix: specify a tiered identity matcher:

  1. Canonical, confirmed DOI/arXiv identity, including arXiv-DOI equivalence; ignore conflicted identifiers.
  2. A distinctive title match corroborated by author or year, reusing `registryTitleAgrees`, `registryTitleIsDistinctive`, and the OpenAlex author parser.
  3. Reference-entry matching only with a distinctive title plus author/year evidence.
  4. Search reference/footnote apparatus, not arbitrary prose.
  5. Exclude the article itself by identifier or title+author/year, never title alone.

  Test both false-positive and false-negative cases, not only Sutskever and ByteNet.

- **F4 — P1: “Bibliography exists” is insufficient; stale and capped lists can still make the worst error.**  
  Evidence: the plan gates only on an absent Bibliography (`docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md:45-46`) and says it compares against the current one (`:64-66`). But `Bibliography.capped` explicitly means works were omitted (`src/types.ts:5562-5568`), and its read response separately reports `stale` (`src/types.ts:5573-5582`).  
  Fix: add explicit `bibliography-stale` and `bibliography-incomplete` outcomes. Do not present candidates as Not cited while either is true unless the UI instead says precisely “not among the works Spideryarn extracted” and prominently warns that extraction was incomplete.

- **F5 — P1: The plan crosses the registry-output security boundary without specifying its defences.**  
  Evidence: OpenAlex is an untrusted bibliographic registry whose strings must be rendered only as text and whose links must be built from identifiers (`docs/project/security-map.md:24-27`). The existing path strips and bounds every string and stores no returned address (`src/citation-index.ts:40-43`); its link builder revalidates DOI/OpenAlex IDs (`src/citer-link.ts:1-24`). The new plan merely labels the abstract “a stranger’s text” (`docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md:26-28`).  
  Fix: require `URLSearchParams` for the request; shape-check IDs and DOIs; strip and bound every title, author, venue, and abstract; bound abstract-inverted-index reconstruction by tokens, positions, and output length; deduplicate IDs/DOIs; render all fields as text; and build every `href` through the existing validated DOI/OpenAlex link helper. Catch fetch errors without logging messages that may contain the query URL.

- **F6 — P1: The stage list omits concrete server and visitor paths required by this sub-mode.**  
  Evidence: `loadArticleIdentity` returns metadata only—no opening, blocks, Bibliography, `capped`, or `stale` state (`src/store/pg.ts:4213-4232`)—yet the plan relies on all of them (`docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md:42-46,70-72`). On the client, `VisitorSourcesBand` currently draws every `SOURCES_VIEWS` chip and routes every non-Bibliography/non-Links value into the Reception/Claims panel (`src/web/modes/sources/SourcesMode.tsx:273-321`). `ReceptionAndClaimsView` likewise excludes only the existing first two views (`src/web/params.ts:1446-1452`).  
  Fix: add to the stages:

  - An owner-scoped `loadRelatedWorkInput` reading query source, publication year, current Bibliography, and its freshness in one coherent revision snapshot.
  - `SOURCES_VIEWS`, `ReceptionAndClaimsView`, `SourcesBand`, `VisitorSourcesBand`, `sourcesCounts`, `countOf`, `VIEW_HOW`, and `activationForSources`.
  - Defined visitor behavior for a shared URL containing `?sources=not-cited`: omit the chip and degrade to an allowed view, rather than drawing an empty or wrong panel.
  - Explicit URL-state, command-bar, owner-only network, surface-shape, count, and visitor tests.
  - The privacy page/doc/test from F1.

- **F7 — P2: The query recipe being built is not the one that was measured and is underspecified.**  
  Evidence: the plan says “title and opening” without defining selection, normalization, or a cap (`docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md:23,32-37`). The supplied measurement was title plus abstract. Existing OpenAlex title search deliberately caps and word-normalizes its query (`src/citation-index.ts:205-235`).  
  Fix: define the exact versioned recipe: imported title, bounded abstract when present, deterministic title-only fallback, normalization, maximum characters, and validated publication year. Measure that exact recipe on a small corpus before calling the ranking evidence. When the article year is unknown, say results were not date-limited so later work is not implied to have been available to cite.

- **F8 — P2: The shared limiter does not prevent duplicate 10-credit searches.**  
  Evidence: `inServiceTurn` provides cooldown, concurrency, and spacing only (`src/bibliographic.ts:536-567`). The existing citation path explicitly acknowledges that concurrent readers may each spend the request (`src/citation-index.ts:49-54`). The plan claims the cache protects the allowance (`docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md:62-66`).  
  Fix: add a per-cache-key database claim or serverless-safe single-flight mechanism. At minimum, document the race and test two concurrent cold reads; a process-local promise alone is insufficient across Vercel instances.

- **F9 — P3: The illustrative row contradicts the acceptance criterion.**  
  Evidence: the mock Not cited list shows Sutskever 2014 (`docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md:26-28`), while the plan says it is cited and must be excluded (`:39-46,113-116`).  
  Fix: replace the mock row with a fixture verified to be genuinely absent, or label it explicitly as the raw OpenAlex result before exclusion.

**Verdict: BUILD WITH CHANGES**