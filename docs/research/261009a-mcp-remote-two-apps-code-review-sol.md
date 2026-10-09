Fixed the spike’s production-target bypasses, credential leaks in error output, OAuth client authentication, callback validation, consent reruns, false-success checks, and metadata cleanup. Updated stale single-client wording and added regression tests.

The exact `https://chatgpt.com` origin preserves F7’s allowlist reasoning. OAuth calls match [Supabase’s documented flow](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows).

Validation: **32 requested tests passed**; typecheck passed via the fallback command. Lint passed with one informational complexity warning.

Wider findings: `src/auth.ts:180` still says “one client”; password-change protection remains untested. An earlier failed run reported leaked test database `spideryarn_test_261009214901_b4a9d92ffd744bf8a9722853ae422d9a`; cleanup was blocked by EPERM.

VERDICT: fixed — `scripts/mcp-oauth-spike.ts`, `tests/mcp-remote.test.ts`, `src/vercel-health.ts`, `docs/project/{mcp,security-map,security-risks,deployment}.md`, `docs/plans/261007p-mcp-remote-sign-in-with-oauth.md`