# Code review: the remote MCP accepts a list of OAuth clients, and ChatGPT's origin

Worktree root = cwd. Review, **fix what you find inside these files**, report anything wider. Run
`npx vitest run tests/mcp-remote.test.ts tests/mcp-remote-boundaries.test.ts tests/mcp-remote-lifetime.test.ts`
and `npm run typecheck` after any fix (typecheck may hit sandbox EPERM; `node --import tsx
scripts/typecheck.ts` is the same).

## Why

Greg wants Spideryarn usable from the ChatGPT desktop app. ChatGPT cannot run a local stdio
server, so it needs the remote route `src/mcp/remote.ts` (plan
`docs/plans/261007p-mcp-remote-sign-in-with-oauth.md`). That route admitted exactly one
preregistered OAuth client (`MCP_OAUTH_CLIENT_ID`), which was meant for Claude. Greg approved
(2026-10-09) letting it accept more than one, so Claude and ChatGPT each get a hand-registered
client. Dynamic client registration stays off (that is a separate decision for Greg).

## What changed (`git diff HEAD`)

1. `src/mcp/remote.ts`: `MCP_OAUTH_CLIENT_ID` is now a comma-separated list, trimmed, empties
   dropped; no entries → `[mcp-off]` as before. `client_id` must be one of them. `Origin` may now
   also be exactly `https://chatgpt.com`.
2. `tests/mcp-remote.test.ts`: a list admits each listed app and refuses an unlisted one; `" , ,"`
   counts as off; `https://chatgpt.com` served, `https://chatgpt.com.evil.example` refused.
3. `scripts/mcp-oauth-spike.ts` (new, untracked): a headless run of the real OAuth flow against the
   local Supabase. Review it for anything that could touch production or leak a token (it must
   print claims, never tokens), and for correctness of the OAuth calls.

Check in particular: whether anything else reads `MCP_OAUTH_CLIENT_ID` as a single value
(`src/vercel-health.ts`, docs: `docs/project/mcp.md`, `docs/project/security-map.md`,
`docs/project/security-risks.md`, `docs/project/deployment.md`) and now says something false; fix
those sentences. Whether allowing `https://chatgpt.com` as an Origin weakens Sol F7's reasoning in
the plan.

End with `VERDICT: ok`, `VERDICT: fixed` (list files) or `VERDICT: rethink`.
