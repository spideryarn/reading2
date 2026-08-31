# Verdict: GO WITH CHANGES

This verdict is against the current tree. `db-seed-owner.ts` changed during my review from status-only handling to `invalid_credentials` discrimination; that newer version is materially safer.

1. **MEDIUM — the session-protection branch is correct but has no automated regression test. Confident.**

   [db-seed-owner.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-seed-owner.ts:125) contains the highest-consequence decision in this change, but it lives inside an import-time script and neither new test exercises it.

   Move the error-code extraction/decision into a pure helper and test:

   - `400 invalid_credentials` → update.
   - `400 user_banned`, `401`, `429 over_request_rate_limit`, `500`, and malformed responses → refuse without mutation.

   Prefer GoTrue’s `x-sb-error-code` response header, optionally falling back to JSON, rather than regexing the body alone. GoTrue v2.195.0 sets that header for structured HTTP errors. [Tagged error handling source](https://github.com/supabase/auth/blob/v2.195.0/internal/api/errors.go).

2. **MEDIUM — the live suite does not exercise its third claimed joint under ordinary `npm test`. Confident.**

   [seed-admin-signin.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/seed-admin-signin.test.ts:98) skips both `handleApi` cases unless `SPIDERYARN_STORE=postgres`. With the normal filesystem default, only sign-in and direct verification run; the real token never crosses the real route gate.

   The file already identifies the solution: a real administrator token gets `501` on the filesystem store only after passing the admin gate. Run that assertion without Postgres:

   - Files store: real token → `501`.
   - Postgres ready: real token → `200`.
   - Both: no token → `401`.
   - Add malformed Bearer token → `401`; anonymous-only proves the door is not completely open, but not that arbitrary non-empty credentials are rejected.

   If Supabase is entirely absent, all four cases still skip and `npm test` can remain green. It reports skips, so this is not completely silent, but it does not prove the header’s full claim.

3. **LOW — the stack gate is safe, but unnecessarily brittle and opaque. Confident on behavior; the `npx` fallback risk depends on machine setup.**

   [db-seed-owner.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-seed-owner.ts:88) is command-injection safe and fails closed. The 120-second timeout is conservative but not incorrect. However:

   - `npx` may resolve or download an unpinned CLI when `supabase` is missing. Invoke `supabase` directly, matching the repository’s other database commands.
   - Discarding stderr hides whether the problem was Docker, permissions, a missing executable, or timeout. Preserve a sanitized diagnostic.
   - [seed-accounts.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/seed-accounts.ts:201) compares URLs literally. Thus the preceding guard/test claims `localhost` and IPv6 are accepted, but CLI output using `127.0.0.1` rejects them. Either normalize loopback origins or deliberately permit only the canonical address.

   Comparing the key is meaningful for detecting cloud credentials copied into `.env.local`, even though both values may historically have come from CLI output. It does not distinguish local stacks because their demo service keys are shared; the URL/project-container evidence does that part.

4. **LOW — three comments/docs overclaim. Confident.**

   - [seed-accounts.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/seed-accounts.ts:35): reaching the port does not let somebody read `.env.local`. Remove that clause; the globally known local service key is sufficient to make the intended argument.
   - [db-seed-owner.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-seed-owner.ts:114): the “browser key” claim is false when it falls back to `serviceKey`. Require/use an anon or publishable key, or weaken the claim.
   - [the plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260831ab-seed-local-admin-user-for-remote-box.md:73) promises a warning in `infra/hetzner/main.tf`, but [the firewall block](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/main.tf:87) has no such warning. The plan also describes the route test’s unconditional `200` without its Postgres-only qualification at [line 171](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260831ab-seed-local-admin-user-for-remote-box.md:171).

The named code paths otherwise check out:

- A Google-only user with no password returns `400 invalid_credentials`; a wrong password returns the same. A rate-limited request returns `429 over_request_rate_limit` before the password handler runs. The current code therefore aborts safely on rate limiting. [Password-grant source](https://github.com/supabase/auth/blob/v2.195.0/internal/api/token.go), [rate-limiter source](https://github.com/supabase/auth/blob/v2.195.0/internal/api/middleware.go).
- The account is not permanently stuck: rate limiting creates a temporary fail-closed refusal; retry after the window succeeds. An unfamiliar response also fails closed without revoking sessions.
- Both email/id refusals run before mutation. Their order is safe, though simultaneous conflicts are reported one per run.
- For two identical creators, refetch-by-ID after `409/422` is sufficient. GoTrue’s create request is transactional; one runner cannot leave the other a deliberately “half-made” row.
- Neither deferred decision blocks this change. Issuer-plus-ID authorization deserves its own scoped change; the generated-password alternative remains a reasonable product/security choice rather than a correctness requirement.