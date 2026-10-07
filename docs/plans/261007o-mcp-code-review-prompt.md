You are reviewing built code in the Spideryarn repo (cwd), and you may fix what you find.

The plan: docs/plans/261007o-mcp-private-link-and-admin-user-tools.md (your own plan review is
docs/plans/261007o-mcp-plan-review-sol.md; its four findings were taken, see the plan).
The diff: docs/plans/261007o-mcp-code-review.diff (against HEAD; the plan file itself is new and untracked).

What was built: three MCP tools in src/mcp/tools.ts (create_private_link, list_users, user_activity);
an optional `keepExisting` on POST /api/article/:slug/share-link (src/routes.ts parseShareLinkRequest,
src/store/pg-share-link.ts create, src/store/contracts.ts); a sentence on the privacy page
(src/web/PrivacyPage.tsx); docs (security-map.md, privacy.md, mcp.md); tests in
tests/mcp-tools.test.ts, tests/share-link-pg.test.ts (needs the local Postgres, which is running),
tests/share-link-token-stays-home.test.ts, tests/privacy-page.test.ts.

Look hardest at: the private link's key leaking anywhere it should not (tool results on refusal,
errors, the dialog text); approval vs execution mismatch; the keepExisting path under concurrency and
its interaction with the owner's card and other callers of shareLinkStore.create (grep for them);
whether any other implementation of ShareLinkStore (fakes in tests, guarded wrappers) now silently
ignores the new option; the admin-only claims; the accuracy of the privacy wording against the code.

Rules: for every defect you fix, write a failing test first and see it fail, then fix. Keep fixes
narrow. Do not commit; do not run git commands that change the index or discard work. Do not invent
quotes from Greg in any doc. Run `npx vitest run tests/mcp-tools.test.ts tests/share-link-pg.test.ts
tests/share-link-token-stays-home.test.ts tests/privacy-page.test.ts` and `npm run typecheck` at the end.

Report: numbered findings C1.. with severity (P0/P1/P2), evidence, and whether you fixed it (and the
test that went red) or are reporting it for a decision. End with `VERDICT: ready` or `VERDICT: not ready`.
