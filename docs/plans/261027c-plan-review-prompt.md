# Plan review: Cited by's DOI confirmation (plan 261027c)

Read `CLAUDE.md` for the house rules, then the plan
`docs/plans/261027c-cited-by-confirms-a-doi-against-arxiv-own-record.md`. Read-only: do not edit.

The code is `src/citation-index.ts` (`isThisArticle`, `citersIdOf`, `arxivDoiAtAddress`,
`twoStructuredAuthorsAgree`, `askWork`, `answerFor`, `theList`, `confirmedWorkOf`, `authorsOf`,
`parseOpenAlexWork`), `src/article-registry.ts` (`registryIsThisArticle`, `registryAuthorIsOurs`,
`nameWords`), `src/bibliographic.ts` (`lookupWork`, `WorkRecord`), the CHECK
`citation_index_lookups_target_authors` in `src/db/schema.ts`, `src/situate-citers.ts`, and the
prior work in `docs/investigations/261025a-code-review-sol.md`.

Questions:

1. Is part 1 (arXiv's DataCite record as the identity, only when the DOI asked is the one the
   article's own arxiv.org address names, only after the article's own facts fail) safe against
   the failures the file header names: a second article carrying a DOI by mistake, a cited work's
   DOI, an author's later page carrying an older arXiv DOI, and OpenAlex attaching an arXiv DOI to
   a different work (the BERT case in the plan)? Is there a case where the article at an arxiv.org
   address is not the arXiv paper with that id?
2. Is applying the full `isThisArticle` (including the two-structured-author route) to the
   DataCite identity the right bar? DataCite creator names vs OpenAlex display names — any
   matching pitfall (e.g. organisations as creators, `familyName` missing)?
3. Parts 2 and 3: first 19 + last author for the target; digits dropped from name words; `--`,
   en/em dashes and spaced ` - ` as prose in titles. Any false-confirm risk, or any effect on the
   import's Crossref check (`withRegistryFacts`) that would be wrong?
4. The cache: `answerFor` checks a cached target on every hit. Becoming async with a possible
   DataCite lookup — any problem (latency, a lookup on every cache hit for these articles, the
   stale path, the topic list)? Would you instead compute the identity once per request?
5. Anything simpler that is still safe?

Write findings with severity (P1/P2/P3) and file:line, most severe first.
