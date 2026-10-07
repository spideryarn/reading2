You are reviewing a short implementation plan in the Spideryarn repo (cwd). Read-only review: do not edit files.

Plan: docs/plans/261007o-mcp-private-link-and-admin-user-tools.md
Context: docs/project/mcp.md, docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md (the MCP server it extends), src/mcp/tools.ts, src/mcp/server.ts, src/routes.ts (search SHARE_LINK_PATTERN and "/api/admin/users"), src/store/pg-share-link.ts, src/admin.ts (AdminUser), docs/project/security-map.md (section "And since 2026-10-05 there is a second way in, which is a key"), tests/share-link-token-stays-home.test.ts, src/web/PrivacyPage.tsx around "we can see what is in the app".

Greg (the owner) has already decided: yes to an agent holding a private link's key (behind the macOS Approve dialog), yes to admin-only MCP tools exposing user email addresses and activity. Do not relitigate those; review whether the plan implements them safely and simply.

Look for: correctness holes (e.g. the private link's key being replaced, approval/execution mismatch, TOCTOU), leaks of the key or of user data beyond what is intended, admin checks that rely on the client, privacy wording that is inaccurate, missing tests, and anything simpler. Number findings F1.., each with severity (P0/P1/P2), evidence (file:line), and a concrete fix. End with a line `VERDICT: go` / `go with changes` / `rethink`.
