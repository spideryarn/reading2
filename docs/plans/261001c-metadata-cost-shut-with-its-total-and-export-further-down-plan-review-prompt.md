Review this plan, read-only, before it is built: docs/plans/261001c-metadata-cost-shut-with-its-total-and-export-further-down.md

Context: two small layout requests from Greg (the admin) on the article metadata page, src/web/Metadata.tsx. The cost section is src/web/ArticleCost.tsx (admin-only; server gate on /api/admin). `Section` (collapsible / aside / keepMounted) is near the bottom of Metadata.tsx. Tests: tests/metadata-page-order.test.tsx, tests/article-cost-section.test.tsx, tests/no-ai-cost-for-readers.test.ts.

Check: (1) does the design leak any cost information or request to a non-admin; (2) is the lifted fetch correct (stale slug, unmount races); (3) is the Export placement the right reading of "further down" given the existing pinned order; (4) anything simpler. Give findings as P0/P1/P2 with file:line, and a one-line verdict at the end.
