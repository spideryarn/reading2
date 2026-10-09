You are reviewing a plan (read-only) in the Spideryarn repo, before it is built.

Plan: docs/plans/261009j-a-public-copy-offered-at-import.md — read it in full.

Context to read: src/routes.ts around the `POST /api/jobs` handler (search "A repeat paste is free") and `parseJobRequest`; src/store/pg-cited-in-spideryarn.ts (the ownerless read the plan reuses); src/store/find-article.ts; src/ingest.ts `urlKey`; src/urls.ts `publicSourceUrl`; src/web/AddPage.tsx (posting effect, Phase, repeat handling); src/web/useJobs.ts; src/web/ProseHoverCard.tsx (Asked kinds, "have"); src/web/PublicChrome.tsx (`PrivateCopy`); src/mcp/tools.ts `import_article`; docs/project/security-map.md; docs/project/billing.md § Which requests spend a slot; docs/plans/261007k-repeat-paste-is-free-and-says-so.md; docs/plans/261007m-a-private-copy-of-a-public-article-on-your-own-shelf.md.

Questions:
1. Security: is reusing `citedCandidates` for this an information leak about any stranger's article beyond what /read/public and the public page already publish? Any private, link-shared, archived or unopenable article that could be revealed? Is matching via urlKey over publicSourceUrl(final_url) safe?
2. Billing: can `ownCopy` or the new answer create a free import, a double charge, or bypass admission?
3. Correctness of the Add page flow: re-posting with ownCopy, StrictMode/once-guards, purpose drafts, High-powered, upload-engine path. The one-shot intent from PrivateCopy — sound or should it be something else?
4. Anything simpler that gets Greg's ask?
5. Anything missed (other callers of POST /api/jobs {url}, docs that need updating, tests).

Write findings as a numbered list, each with severity (P1/P2/P3), the file/line evidence, and a concrete fix. End with a one-line verdict: "ready", "ready with changes", or "not ready".
