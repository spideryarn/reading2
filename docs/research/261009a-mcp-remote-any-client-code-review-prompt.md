# Code review: `MCP_OAUTH_CLIENT_ID=*` admits any dynamically registered OAuth client

Worktree root = cwd. Review, **fix what you find inside these files**, report anything wider. Run
`npx vitest run tests/mcp-remote.test.ts tests/mcp-remote-boundaries.test.ts tests/mcp-remote-lifetime.test.ts tests/doc-links.test.ts`
and typecheck (`node --import tsx scripts/typecheck.ts` if `npm run typecheck` hits EPERM).

## Why

Greg wants Spideryarn's remote MCP (`src/mcp/remote.ts`, plan
`docs/plans/261007p-mcp-remote-sign-in-with-oauth.md`) usable from any MCP app — ChatGPT, Cursor,
Goose — with just the URL. On 2026-10-09 he explicitly turned on Supabase's dynamic client
registration in production, accepting Sol F6's phishing risk while the route is admin-only. So
the gate must accept a token from any client Supabase issued one to.

## What changed (`git diff HEAD`)

- `src/mcp/remote.ts`: `*` in the `MCP_OAUTH_CLIENT_ID` list admits any non-empty string
  `client_id`; lists still work; unset/empty still off. Header comment updated.
- `tests/mcp-remote.test.ts`: `*` admits two different apps' tokens; still refuses a browser token
  (no client_id), a non-string client_id, and a non-admin (403).
- `supabase/config.toml`: local `allow_dynamic_registration = true`, matching production.
- Docs: `docs/project/mcp.md` (section renamed and rewritten), `security-map.md`,
  `security-risks.md` (R14), `deployment.md`, the 261009a research doc.

Check in particular: is there any token Supabase issues that carries a `client_id` but is not an
OAuth-server token (so `*` would admit something unintended)? Does `*` mixed with ids behave
sensibly? Are the security docs accurate and do they state the F6 risk plainly? Is anything still
saying "dynamic registration off" or "one client"? Does `src/vercel-health.ts` say something now
false?

End with `VERDICT: ok`, `VERDICT: fixed` (list files) or `VERDICT: rethink`.
