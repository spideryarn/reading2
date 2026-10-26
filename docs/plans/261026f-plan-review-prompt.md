# Plan review: 261026f

Review the plan docs/plans/261026f-cited-by-when-there-is-no-doi-from-the-full-text-and-a-web-search.md
before it is built. Read-only: do not edit any file. Evidence: the investigation
docs/investigations/261026a-cited-by-with-no-doi-full-text-and-web-search-recall-and-cost.md, its
script scripts/spikes/261026a-cited-by-full-text.ts, your own design consult
docs/plans/261026f-design-consult-sol.md, and the code the plan names (src/citation-index.ts,
src/routes.ts § GET /api/citers, src/store/pg-citation-index.ts, src/related-work.ts and its store
and table in src/db/schema.ts, src/citation-blurbs.ts § importedFromAPublicAddress,
src/web/useCiters.ts, src/web/ReceptionAndClaimsPanel.tsx § CitersAnswer). Project rules are in
CLAUDE.md; docs/project/sql.md, docs/project/privacy.md and docs/project/security-map.md matter here.

Find what would be wrong or silently broken if built as written: correctness, privacy, the cache
key and its invalidation, what is sent to OpenAlex and when, injection through a title into the
OpenAlex filter, the gate's arithmetic and edge cases (no year, tiny counts, a future year), the
honesty of the reader-facing words, the stage split, and anything the plan forgets to tell
(deletion, export, transfer, rollback, help, privacy page, tests). Also say whether you still hold
your consult's view that the free list should stay experimental, given the 94% measured with your
filters. Number findings F1…, each with a severity (P0 blocks, P1 must fix before building, P2
should fix), the evidence, and the fix. Under 1,500 words.
