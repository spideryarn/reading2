No default token bypass found. Supabase ID tokens also carry `client_id`, but the existing role check rejects them. Trusted custom token hooks can alter claims; production hook settings were not verified. [Supabase source](https://github.com/supabase/auth/blob/master/internal/tokens/service.go).

Fixed misleading revocation instructions, understated F6 exposure, token-confidentiality claims, and stale research wording. Added coverage for mixed `*`/id lists, empty/null ids, metadata spoofing, and ID tokens.

Validation: **52 requested tests passed**, typecheck passed using the fallback, lint and diff checks passed.

Wider findings left unchanged:

- `src/vercel-health.ts:447` still describes hand-registered clients only.
- `src/routes.ts:9151` still says “one client.”
- The 261007p plan amendment still says dynamic registration remains off.
- Production password-change protection remains unverified.

VERDICT: fixed — `src/mcp/remote.ts`, `tests/mcp-remote.test.ts`, `docs/project/mcp.md`, `docs/project/security-map.md`, `docs/project/security-risks.md`, `docs/research/261009a-one-click-mcp-install-for-claude-and-chatgpt.md`.