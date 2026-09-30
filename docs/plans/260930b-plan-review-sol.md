# 260930b plan review — GPT Sol (gpt-5.6-sol, effort high, read-only)

The review of [260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md](260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md) before it was built, verbatim. All four P1s and both P2s were taken; the plan says how.

1. **P1 — The owner boundary is caller-selectable.**  
   Evidence: `docs/plans/260930b…md:28` gives `citedArticleCandidates` an `ownerId`. Passing another owner’s ID would classify their private articles as “mine” and return their titles/slugs. `loadCitations` is already owner-scoped through `currentRevision` (`src/store/pg.ts:3581`, `src/store/pg.ts:1321`), so this extra authority is unnecessary.  
   Proposed fix: expose only `citedArticleCandidates(excludeArticleId)` and obtain `currentOwnerId()` inside the store leaf. A query-builder helper may accept an owner for testing, but the production API must not.

2. **P1 — Raw URLs create an oracle for private provenance of a public article.**  
   Evidence: the plan selects and matches both raw `requested_url` and `final_url` for strangers’ public articles (`plan:28-40`). The public reader deliberately publishes `final_url` only through `publicSourceUrl` (`src/store/public-reader.ts:257`); that policy refuses query strings because they may be a paywall-bypass capability belonging to the owner (`src/urls.ts:200`). An exact address match would confirm that a hidden signed/request URL belongs to a named public article, even though it does not print the URL.  
   Proposed fix: raw requested/final URLs may be used for the reader’s own candidates. For another owner’s public article, match only a `final_url` accepted by `publicSourceUrl`; do not use `requested_url` without a separate decision to make that provenance public.

3. **P1 — Owner candidates without the readability bar are not necessarily openable.**  
   Evidence: the plan says an owner can open a half-made article (`plan:33`), but the owner reader returns 404 when the current revision lacks a tree or blocks (`src/store/pg.ts:2549`), and the owner’s shelf drops the same rows (`src/store/pg.ts:2624`). The proposed link can therefore promise “In your library” and open a 404.  
   Proposed fix: apply the tree-and-block readability bar to both own and public candidates. Keep the public/private distinction only for visibility and title handling.

4. **P1 — The address rule deliberately reintroduces false equivalences that `requestTarget` rejects.**  
   Evidence: the plan drops scheme, `www.`, and trailing slash (`plan:41`). `requestTarget` explicitly preserves scheme, host, port, path, and query because HTTP/HTTPS and other superficially similar URLs may serve different pages (`src/urls.ts:357`, `src/urls.ts:396`). `sameTarget` already handles the null case correctly (`src/urls.ts:625`).  
   Proposed fix: use `sameTarget` unchanged. Any looser equivalence should require independent identifier or title corroboration.

5. **P1 — Three `wordsOf` words are too weak, and an owner rename must not become bibliographic identity.**  
   Evidence: `wordsOf` removes stopwords and every one-character token (`src/citations.ts:596`). Thus “Learning Systems Part 1” and “… Part 2” both reduce to the same three words. The existing identity code explicitly says `wordsOf` is wrong for identity because it collapses “Part 1” and “Part 2” (`src/citations.ts:899`). Using `title_override` for matching also lets “My key paper” hide a true match or manufacture a false one; it is a display relationship, not document identity. Slug-order tie-breaking only makes an ambiguous answer deterministic.  
   Proposed fix: return separate `matchTitle` and `displayTitle`; always match the extracted revision title, while displaying the owner override only to its owner. Use the identity-preserving normalization used by `keysOf`, require at least four tokens, and refuse title-only matches that remain ambiguous—or corroborate short titles with author/year. Excluding another owner’s `title_override` is unequivocally correct (`src/public/dto.ts:118`, `src/store/public-library.ts:194`).

6. **P2 — `identifiersIn` extracts textual substrings; it does not prove that a URL identifies the candidate.**  
   Evidence: its regexes find a DOI or `arxiv.org/...` anywhere in supplied strings (`src/citations.ts:497`, `src/citations.ts:528`). An unrelated redirect/query URL or a hostname containing `arxiv.org` can therefore match. By contrast, `linkFor` requires exactly one identifier in an unambiguous entry (`src/citations.ts:773`).  
   Proposed fix: parse candidate URLs structurally. Trust canonical DOI/arXiv hosts and paths directly; for identifiers embedded in publisher paths, require exactly one candidate identifier and title corroboration. Add adversarial query-string and lookalike-host tests.

7. **P2 — Existing guards will not fail, so the new query needs its own SQL-level defence test.**  
   Evidence: owner-isolation section 2 detects only bare `eq(articles.slug, …)` lookups (`tests/owner-isolation.test.ts:225`). The enumeration guard walks only the public import graph (`tests/owner-isolation.test.ts:644`); an authenticated module imported only by `pg.ts` is outside it. Likewise, `public-imports` passes provided the public graph still cannot reach `pg.ts` (`tests/public-imports.test.ts:80`, `tests/public-imports.test.ts:142`). No existing defence test needs editing.  
   Proposed fix: add a feature-local generated-SQL assertion for the grouped owner/public predicate, readability, archive and self-exclusion clauses, plus the planned three-owner Postgres test. Keep the import direction strictly authenticated. Attach matches after `attachFinds` if found web addresses should participate; visitors remain safe because the public DTO reconstructs every cited-work field and omits additions (`src/public/dto.ts:526`).

Verdict: **Revise before implementation—there is no unavoidable private-article leak, but the owner parameter, raw public provenance, readability claim, and matching rules leave four P1 holes.**