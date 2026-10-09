Review the plan docs/plans/261009d-every-version-of-an-arxiv-paper-is-one-article.md (read-only; do not edit files).

Context: a reader pasted arxiv.org/abs/2609.01481 while holding an article imported from a ...v1 link, and got a duplicate. The plan changes `key` in `arxivPaper` (src/paper-sources.ts) to use `workId` (versionless) instead of `versionedId`, so `urlKey` (src/ingest.ts) makes every version one article, and adds a few unambiguous tracking params to TRACKING in src/ingest.ts.

Check, against the code:
1. Does every "do we already have this?" path really go through urlKey/paper.key (src/store/find-article.ts slugForUrlKey, src/jobs.ts, src/routes.ts ~12534, src/web/link-facts.ts, src/store/jobs.ts source column, freeSlug adoption in ingest)? Anything that persists a key with a version and would now mismatch, or a unique index that would now collide in a harmful way?
2. Anything that relies on paper.key containing the version (e.g. tests asserting key === urlKey(canonicalUrl), other sources reusing arxivPaper such as Hugging Face/alphaXiv, citations, the registry, link previews)?
3. Is the trade-off (v2 paste returns the held v1 article; refresh refetches v1) stated correctly, and is there a cheaper middle ground that I missed that does NOT add real complexity?
4. Are the proposed tracking params safe? Any other cheap, safe normalisation clearly missing?
Answer with a numbered findings list (severity P1/P2/P3, file:line evidence) and a one-line verdict.
