You are reviewing BUILT code in the Spideryarn repo (this worktree), and you may fix what you find inside this stage.

The work: docs/plans/261009j-a-public-copy-offered-at-import.md (read it in full, including "What the plan review changed"). Your own earlier plan review is docs/plans/261009j-public-copy-plan-review-sol.md.

The diff under review is docs/plans/261009j-public-copy-code-review.diff (commit 427a08c84 against 0e3efba02). Files: src/routes.ts (POST /api/jobs, parseJobRequest), src/public-copy.ts, src/web/AddPage.tsx, src/web/own-copy-intent.ts, src/web/PublicChrome.tsx, src/web/ProseHoverCard.tsx, src/web/useJobs.ts, src/mcp/tools.ts, src/messages.ts, tests (billing-admission, add-page-purpose, add-to-shelf-from-the-card, private-copy-offer, mcp-tools), and five docs.

Look hard for:
1. Billing: any path to a free import or an extra charge; ownCopy parsing; anything that reaches enqueue with ownCopy still in it.
2. Security: anything about a stranger's article (private, link-shared, archived, unopenable, title override, requested_url/asked_url) that can reach the asker. Is the slug/title the only thing that crosses?
3. AddPage state: StrictMode double-run, address changes mid-request (a late publicCopy answer for an old address), Retry, the ownCopy ref vs the posted guard, High-powered/purpose/sharing never touching the public slug, upload path unaffected.
4. Hover card: the asked map across reader changes (generation), "public" state after own-copy press, refusals after own-copy.
5. The own-copy one-shot: stale marks, reader change, normalisation mismatch with the add page's `source`.
6. Docs that are now false anywhere else in docs/ (grep for "repeat: true", "{ article, repeat", "spends a slot", "import_article").

House rules: the reviewer fixes what it finds inside this stage, each fix with a test you have seen fail first where practical; anything wider, report and do not fix. Do not run git commands that discard work; do not commit. Run `npm run typecheck` and the touched test files (`npx vitest run <file>`; the billing-admission file needs `REQUIRE_POSTGRES=1`).

Write your findings to the answer file as a numbered list: severity (P1/P2/P3), file:line evidence, what you changed (if anything) and the test. End with one line: "ready", "ready with changes (made)", or "not ready".
