You are reviewing a plan before it is built, in the Spideryarn repo (cwd). Read-only review.

Plan: docs/plans/261010n-reception-says-plainly-why-it-is-empty-and-finds-an-arxiv-paper-s-doi.md

Read it, then the code it touches, and check its claims against the code:
- src/web/ReceptionAndClaimsPanel.tsx § emptyGroupNote and its call sites; src/messages.ts (RECEPTION_RESPONSES_NONE, receptionResponsesUnverified, SOURCES_CLAIMS_*, CITERS_NO_DOI); src/types.ts ReceptionCounts / ReceptionLosses; src/reception.ts where counts are computed.
- src/article-registry.ts § withRegistryFacts; src/bibliographic.ts (parseWorkId, arXiv -> 10.48550/arxiv DOI, the DataCite record's doi field); src/backfill-registry-facts.ts.
- src/citation-index.ts § citersOf; src/store/pg.ts § loadArticleIdentity; src/store/contracts.ts; the /api/citers route in src/routes.ts.
- src/web/sub-modes.ts § SOURCES_SUB_MODES.
- docs/project/copy.md (the rules for reader-facing messages).

Questions:
1. Is each factual claim in "What is actually going on" right? In particular: does every arXiv import end with no meta.doi? Is reportedRows the right predicate for "the AI put none forward", given caps, malformed rows and the legacy two-pass documents?
2. Is putting 10.48550/arxiv.<id> on meta.doi at import safe for every other reader of meta.doi (paper-evidence, pipeline metadata carry-over, library-scalars, export, the Metadata page, Bibliography self-citation, anything else)? Anything that would now behave wrongly because an arXiv preprint has a DataCite DOI?
3. The citersOf fallback from the article's own address: is meta.url the right field, is it stored on the revision, could it name a different paper than the article (e.g. a blog post about an arXiv paper whose address is not arxiv.org — fine — but any import path where url is an arXiv address of a *different* work)? Is the title-and-author check sufficient there? Cache keying by id still right?
4. Are the new sentences true in every case they would be shown, and plain? Propose better wording if not. Is there a "what next" each should carry, per copy.md?
5. Anything simpler, or anything missing (tests, docs that must hear about it: reception.md § Cited by, sources.md, 261004h)?

Write findings numbered F1.., each with severity (P1 blocks / P2 should fix / P3 nit), the evidence (file:line), and the fix. End with a one-line verdict.
