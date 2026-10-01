Code review, with permission to fix what you find inside this change. Worktree: the current directory. The change is uncommitted: see `git diff HEAD -- src/web/ArticleCost.tsx src/web/Metadata.tsx tests/article-cost-section.test.tsx tests/metadata-page-order.test.tsx`.

Plan (with what the plan review changed at the end): docs/plans/261001c-metadata-cost-shut-with-its-total-and-export-further-down.md. Plan review answer: docs/plans/261001c-metadata-cost-shut-with-its-total-and-export-further-down-plan-review-sol.md.

Two requests from Greg (admin) on the article metadata page: (7G) the admin-only "What it cost" section shut by default, showing only the total/summary; (7H) Export section further down. Hard constraint: cost information must remain admin-only (no render and no request for non-admins).

Evidence: `npx vitest run tests/article-cost-section.test.tsx tests/metadata-page-order.test.tsx tests/no-ai-cost-for-readers.test.ts tests/metadata-export-button.test.tsx tests/metadata-delete-permanently.test.tsx` passes (12 + others); `npm run typecheck` exit 0. The slug-guard test was seen red with the guard removed.

Check especially: the summary string matches the body's figure in every state (floor/unpriced/silent/empty/failed); the failed state cannot be sealed in a shut section (see Section in Metadata.tsx and postmortem 260903d); the new source-shape pins are not vacuous; nothing a non-admin renders or requests changed; comments in Metadata.tsx that still describe the old order (e.g. "the page ends at Export", Export "above the machinery", "Still above Archive") — grep for stale ones across src/web/Metadata.tsx, PageContents, tests and docs/project/*.md (metadata/export docs) and fix them.

Fix P1/P2s inside this change directly, keep the edits minimal, and do not commit. Report: each finding P0/P1/P2 with file:line, what you changed, anything wider left for me, and a one-line verdict. Do not run the full test suite (box is shared); run the scoped tests above and `npm run typecheck`.
