You are reviewing built code in the Spideryarn repo (cwd), and you may fix what you find.

The plan: docs/plans/261007p-mcp-remote-sign-in-with-oauth.md — read "§ Revised after Sol's plan
review" first; it answers your own plan review, docs/plans/261007p-mcp-plan-review-sol.md (F1–F10).
The diff of tracked files: docs/plans/261007p-mcp-stage-1-code-review.diff. New, untracked files (read them
whole): src/mcp/remote.ts, src/site-origin.ts, src/web/OAuthConsentPage.tsx,
tests/mcp-remote.test.ts, tests/mcp-remote-import-graph.test.ts, tests/oauth-consent-page.test.tsx.

What was built: `requireUser` refuses tokens with a client_id; `POST /api/mcp` (dispatched in
serveApi before the gate) accepts only OAuth tokens whose client_id equals MCP_OAUTH_CLIENT_ID (unset →
refuses all), admin only, Origin checked, a fresh McpServer + stateless transport per request, tools run
through an in-process Api that calls handleApi with a private per-request sentinel verifier; asking
tools refuse via CannotAsk; `GET /api/mcp/resource-metadata` (RFC 9728) and a vercel.json well-known
rewrite; the consent page /oauth/consent using supabase-js auth.oauth.*; billingReturnOrigin moved to
src/site-origin.ts; docs in security-map.md and mcp.md.

Look hardest at: any way an OAuth token reaches a route other than /api/mcp; any way the sentinel
verifier could accept something else or outlive its request; the claim checks shared between the two
gates (is anything weaker for /api/mcp than for requireUser?); serveApi's catch/finally/logging when the
MCP branch throws after headers are set; the WWW-Authenticate header surviving to the 401; body size
and streaming in the Node↔web conversion; spend attribution and owner box for the inner handleApi calls;
the consent page's redirect following (open redirect? only Supabase's redirect_url, http(s)), its
sign-in return keeping authorization_id, and wording that overclaims; billingReturnOrigin behaviour
unchanged; whether the docs say anything the code does not do.

Rules: for every defect you fix, write a failing test first and see it fail, then fix. Narrow fixes.
Do not commit; no git commands that change the index or discard work. Do not invent quotes from Greg.
At the end run `npx vitest run tests/mcp-remote.test.ts tests/mcp-remote-import-graph.test.ts
tests/oauth-consent-page.test.tsx tests/auth.test.ts tests/public-read-rewrite.test.ts
tests/mcp-tools.test.ts tests/mcp-stdio.test.ts tests/billing-checkout.test.ts` (mcp-remote needs the
local Postgres; if your sandbox cannot reach it, say so plainly) and `npm run typecheck`.

Report: numbered findings C1.. with severity (P0/P1/P2), evidence, and fixed (with the test that went
red) or reported for a decision. End with `VERDICT: ready` or `VERDICT: not ready`, and if not ready
because of something you could not run, say that separately from defects.
