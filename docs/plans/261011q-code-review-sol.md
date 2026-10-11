1. **C1 — P2:** `titleMatchOf` counted full-name and initial variants of one person as two authors, allowing a false match. Fixed by deduplicating compatible name variants while preserving distinct authors sharing a surname/initial. Added red-then-green tests. [citation-index.ts](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/citation-index.ts:368)

2. **C2 — P2:** Unexpected fetch/store errors could log their message via `errorFields`, exposing a title-bearing search URL, title, or author. Fixed by logging only the safe cache key, outcome, and timing. Added a regression test containing all three sensitive values. [citation-index.ts](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/citation-index.ts:632)

3. **C3 — P3:** The client accepted malformed target IDs, and an unexpected `doi` property could make the matched-record link prefer that DOI instead of the OpenAlex W ID. Fixed validation and made the link explicitly W-ID-only. [useCiters.ts](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/web/useCiters.ts:53), [ReceptionAndClaimsPanel.tsx](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/web/ReceptionAndClaimsPanel.tsx:1807)

4. **C4 — P3:** `citersOf` promised never to throw, but dependency loading happened outside its error boundary. Fixed to return `unavailable`; added a regression test. [citation-index.ts](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/citation-index.ts:569)

5. **C5 — P3:** Reader copy overstated the evidence and misdescribed some `unavailable`/`too-large` outcomes. It now states the exact two-author or author-plus-nearby-year rule and uses outcome-neutral failure wording. [messages.ts](/var/tmp/spideryarn-worktrees/fbvh0z7s-cited-by-openalex/src/messages.ts:5801)

Gates:

- Four runnable requested test files: **258 passed**.
- `citation-index-pg.test.ts`: **not run**; the local Postgres/Docker lane was unavailable with `EPERM`. No production database was touched.
- `npm run typecheck`: wrapper hit sandbox `tsx` IPC `EPERM`; the same script via `node --import tsx scripts/typecheck.ts` passed all four projects and all 3,700 source files.
- `npm run db:chain`: passed.
- `git diff --check`: passed.
- No commit made.

No wider author decision remains, but the Postgres test should be rerun where the local database is available.

VERDICT: LAND AFTER FIXES