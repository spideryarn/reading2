You are reviewing an implementation plan in the Spideryarn repo (cwd). Read-only review: do not edit files.

Plan: docs/plans/261007p-mcp-remote-sign-in-with-oauth.md
Context: docs/project/mcp.md; docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md (§ Deferred,
and your earlier finding F5 there: an OAuth token for the MCP must not be replayable to the rest of /api/*);
src/mcp/{tools,server,api,approve}.ts; src/auth.ts (requireUser, Verifier); src/routes.ts (handleApi,
serveApi, the Stripe webhook branch before the gate, serveAuthenticatedApi, the admin namespace gate);
src/vercel.ts and vercel.json (how /api/* reaches the function); supabase/config.toml ([auth.oauth_server]);
docs/project/security-map.md; docs/project/database.md (the Data API does not expose our schema).
Installed: @modelcontextprotocol/server 2.3.1 (has WebStandardStreamableHTTPServerTransport, createMcpHandler,
auth helpers), @supabase/supabase-js 2.112.4 (has auth.oauth.getAuthorizationDetails/approveAuthorization/
denyAuthorization). Supabase OAuth server facts from docs: tokens are normal project JWTs with aud
"authenticated" plus a client_id claim; PKCE required; DCR optional; consent page at
<SiteURL><authorization_url_path>?authorization_id=…; authorization server metadata at
<SUPABASE_URL>/.well-known/oauth-authorization-server/auth/v1; no documented RFC 8707 resource binding.

Greg (owner) chose OAuth via Supabase over a fixed key, and approved changing the sign-in gate. Do not
relitigate that; review whether this plan is safe, correct and as simple as it can be.

Look for: token audience/replay problems (to our API, to Supabase's own Auth API, to the Data API);
the in-process Api design (dispatching through handleApi with a verifier bound to the verified identity —
is that sound, and is there a simpler or safer seam?); consent-page phishing with dynamic client
registration; MCP spec compliance problems that would stop Claude.ai's custom connector working
(resource metadata location, WWW-Authenticate, stateless Streamable HTTP on Vercel, the audience/resource
parameter Claude sends and Supabase may reject); the remote refusal of asking tools; anything that
breaks the local stdio server; missing tests. Number findings F1.. with severity (P0/P1/P2), evidence
(file:line or URL), and a concrete fix. End with `VERDICT: go` / `go with changes` / `rethink`.
