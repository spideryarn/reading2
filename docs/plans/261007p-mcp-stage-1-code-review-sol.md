1. **C1 — P1 — Fixed: consent could approve an unreviewed request.** Old details remained while Allow used a new `authorization_id`; stale callbacks could also redirect after navigation. Bound state and callbacks to the current request and subscribed to query changes. The approval, stale-redirect, and history-navigation tests in [oauth-consent-page.test.tsx](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/tests/oauth-consent-page.test.tsx:189) went red before their fixes.

2. **C2 — P2 — Fixed: oversized bodies destroyed the connection before the 413.** The default stream iterator destroyed `IncomingMessage` on early exit. Changed it to preserve the transport and drain unused bytes. The [oversized-body test](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/tests/mcp-remote-boundaries.test.ts:37) reproduced `req.destroyed === true` before the fix.

3. **C3 — P2 — Fixed: disconnects left MCP resources and identity access alive.** Added disconnect handling, exchange settlement, and sentinel retirement. Already accepted inner work remains awaited, preserving accounting and deferred tasks. Both [lifecycle tests](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/tests/mcp-remote-lifetime.test.ts:40) went red before their fixes.

4. **C4 — P2 — Fixed: consent understated the credential’s authority.** Qualified the tool restrictions and disclosed broader Supabase account access. Corrected the security map’s claim that this risk was already accepted. The [disclosure test](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/tests/oauth-consent-page.test.tsx:232) went red first.

Final verification: **163 tests passed across nine database-free suites**; targeted lint and whitespace checks passed. The repository typecheck script passed via `node --import tsx scripts/typecheck.ts`.

Separately, required verification remains blocked: local Postgres access returned `EPERM`, the stdio suite could not open its listening socket, and `npm run typecheck` hit the CLI’s IPC socket restriction. No unresolved defects found, but the requested checks are incomplete.

Root causes recorded in four postmortems. No commits or index changes.

**VERDICT: not ready**