The design is reasonable, but the cache can bypass identity verification, and the proposed experimental gate contradicts the existing contract. No P0 findings.

All candidate line references below refer to [the plan](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/docs/plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md).

1. **F1 — P1 — A cache hit bypasses verification of this article.**  
   **Plan lines 44, 100–112.** The lookup table stores the DOI, count and OpenAlex id, but no target title. After article A populates the cache, article B with a mistyped DOI pointing to A receives A’s citers immediately. The same problem applies to stale fallback.

   **Change:** Cache the target record’s identity evidence from OpenAlex and verify it against the caller on **every** return path, including fresh hits and stale fallback. Test a correct article populating the cache followed by a different article using that DOI.

2. **F2 — P1 — The verification title must exclude reader renames.**  
   **Plan lines 60, 118–119.** The route’s instruction to read article `meta` leaves a consequential choice unspecified. The normal owner read applies `titleFor` to metadata: [src/store/pg.ts:2811](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/src/store/pg.ts:2811). A reader renaming a paper would therefore cause a correct DOI to fail the title check.

   **Change:** Explicitly use the original revision metadata for identity verification, after the owner check. Add a renamed-paper case that still receives its citers.

3. **F3 — P1 — Title agreement alone repeats an identity defect already addressed here.**  
   **Plan lines 55–61.** The premise that every new import’s DOI was registry-verified is false. `withRegistryFacts` preserves existing metadata when lookup fails or disagrees; the pipeline also preserves previous DOIs. The offline script confirmed that a fresh metadata object retains its unverified DOI after an unavailable lookup.

   Moreover, [src/article-registry.ts:123](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/src/article-registry.ts:123) explicitly describes different works sharing an exact title. Its import check requires both title and author agreement at line 216.

   **Change:** Remove the verified-import premise. Corroborate the OpenAlex target with an article author as well as the original title, using a defined adapter for OpenAlex author names. Test identical titles with different authors, including cached answers. Do not describe missing corroboration as proof that the DOI belongs to another work.

4. **F4 — P1 — Debate has no server-side experimental gate to copy.**  
   **Plan lines 118–119, 215.** [src/routes.ts:9252](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/src/routes.ts:9252) delegates directly to `loadDebate`; that read performs ownership checks, without checking the experimental setting. [experimental-features.md:37](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/docs/project/experimental-features.md:37) defines the switch as control visibility: bookmarked modes remain reachable.

   **Change:** Keep the owner-only route and remove the proposed server experimental gate. Test an owner with the switch off opening a bookmarked Reception URL successfully, while another owner and a signed-out caller are refused.

5. **F5 — P1 — Dropped rows and a capped page need different disclosures.**  
   **Plan lines 63–71, 93, 158.** Parsers deliberately drop untitled records and merge duplicates, but the result and cache retain no loss information. Consequently, `count > citers.length` does not mean 100 records were fetched. A 39-record response with one rejected title leaves 38 rows; a capped 100-record response with five rejected rows leaves 95. Neither supports the proposed “100 most cited” sentence.

   **Change:** Carry and persist the number returned, the number rejected or merged, and whether the page limit omitted further results. Print the actual number listed and distinguish filtering from the page cap. Test both examples and a nonzero provider count with no displayable rows.

6. **F6 — P1 — A 100-record page does not solve the byte-limit failure.**  
   **Plan lines 35–36, 74–78, 156.** The fetcher caps actual response bytes before parsing at [src/fetch.ts:2433](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/src/fetch.ts:2433). Reducing 200 records to 100 reduces typical size, but author affiliations remain variable and unbounded. An oversized answer can fail identically on every retry while the panel says it could not reach OpenAlex.

   **Change:** Specify a bounded size-failure path: request fewer records when the response exceeds the cap, reporting the resulting shorter list honestly. If even one record exceeds the bound, show a specific non-retryable limitation. Include an oversized affiliation fixture.

7. **F7 — P2 — Separate the service vocabulary from bibliographic record provenance.**  
   **Plan lines 79–81.** `Registry` currently governs both `WorkRecord.source` and limiter operations at [src/bibliographic.ts:51](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/src/bibliographic.ts:51). Merely widening it would permit OpenAlex provenance in the existing record cache, whose source CHECK still permits only Crossref and DataCite. The limiter also has an `EXPECTED_SLOTS` table at [src/store/pg-bibliographic.ts:61](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/src/store/pg-bibliographic.ts:61).

   **Change:** Name a separate service union for limiter operations, retain the existing registry provenance union, and enumerate the schema types, slot inventory and migration changes required for the third service.

8. **F8 — P2 — Specify the pre-search composition and test the actual activation paths.**  
   **Plan lines 128, 147–149, 216–218.** Today the Scholar link, segmented control and scroller all sit inside `debate && ready` at [src/web/DebatePanel.tsx:1096](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/src/web/ReceptionAndClaimsPanel.tsx:1096). Adding the section where Scholar currently lives will not expose it before a search. Also, a normal Debate press already arms the paid job through `MODE_TARGET.debate`; an independent citer loader does not change that.

   **Change:** Explicitly place the owner Reception section outside the artefact-ready condition. Define navigation before an artefact exists. Test a bookmarked arrival making the citer request without starting a job, and a normal mode press retaining exactly one existing paid-search activation.

9. **F9 — P2 — The proposed tables omit the timestamp-check integration.**  
   **Plan lines 100–105, 214.** Neither table has `created_at`. Using `fetched_at` for the lookup and inheriting its event time for child rows are reasonable, but the repo requires those exceptions to be registered. [tests/action-tables-have-created-at.test.ts:37](/home/greg/code/spideryarn2/.claude/worktrees/qi-aabv7jjy-debate-openalex-citers/tests/action-tables-have-created-at.test.ts:37) currently knows neither table.

   **Change:** Register the lookup’s `fetched_at` and a justified child-table exemption, or add appropriate timestamps. Explicitly pin the replacement transaction to `READ_COMMITTED`.

The separate model-free `GET` is acceptable: cached link previews already use that pattern at `src/routes.ts:8679`. Two tables with `text[]` authors fit the SQL default, although SQL does permit a justified opaque JSON cache. Keeping this independent of the paid Debate artefact and withholding it from visitors are coherent v1 choices.

I ran one offline script, made no network requests, and edited no files. It also confirmed that an agreed arXiv record currently does **not** populate `meta.doi`; the plan should avoid implying automatic arXiv coverage.

**Verdict: build with the P0/P1 fixes.**