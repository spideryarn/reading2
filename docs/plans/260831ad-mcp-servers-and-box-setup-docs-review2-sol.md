# STOP

## BLOCKERS

1. **P1 — `MUST_BE_LOCAL` is bypassable.** `pg-connection-string` lets `?host=` override the authority host:

   `postgres://u:p@127.0.0.1/db?host=remote.example.com`

   Result: `guard=true`, but `pgHost=remote.example.com`. This bypasses both [the new guard](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-env.ts:250) and [the migration guard](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-migrate.ts:90), while TLS is disabled. Validate the effective pg host and exact local port, or reject host/port query overrides.

2. **P1 — blocker 2 remains.** The fix validates URLs but still sends `SUPABASE_SERVICE_ROLE_KEY` without validating its value ([allowlist](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-env.ts:64)). A production service-role key can therefore reach the box alongside loopback URLs. The banner “production credentials are deliberately absent” is also literally false because paid model-provider credentials are deliberately present. Validate/generate local Supabase credentials and narrow the banner.

3. **P1 — Vercel deployment still lacks human confirmation.** “No `--dangerously-skip-permissions`, so it prompts” is false. Current Claude Code defaults Pro/Max/Team terminal sessions to Auto mode, where a classifier may approve network actions; explicit `ask` rules force prompts ([permission modes](https://code.claude.com/docs/en/permission-modes), [rule precedence](https://code.claude.com/docs/en/permissions)). Put `mcp__vercel__deploy_to_vercel` in `permissions.ask`.

   You also missed the previously flagged `get_access_to_vercel_url`, which creates an unauthenticated shareable link to protected deployments. Deny or ask it. [Vercel’s own guidance recommends human confirmation](https://vercel.com/docs/agent-resources/vercel-mcp/tools).

4. **P2 — the MCP doctor’s stale-checkout diagnosis is incomplete.** It calls something “stale” only when *all* wanted names are missing. If a future checkout has three old servers and the local clone adds a fourth, doctor tells the operator to log into the missing server—even though it is not configured remotely. Same-name URL changes pass entirely. Compare the remote `.mcp.json` contents or hash before checking health.

5. **P2 — new prose is false.**

   - A local `allow` cannot override a project `deny`; deny wins regardless of specificity or settings source. An agent must edit/remove the deny or use another route.
   - Doctor does depend on the checkout through its remote `cd`, and skipping MCP authentication makes it fail. Therefore “skipped 3–7 gets a green doctor” is false.
   - `REQUIRE_POSTGRES=1 npm test` does not prove step 7; doctor does.
   - “Two of eleven tools” and the exact buy-tool count are drift-prone unless explicitly dated.

## Direct answers

1. **No**, `MUST_BE_LOCAL` is insufficient: `?host=` is a concrete bypass, and Supabase credential values remain unchecked.
2. **No**, leaving deployment unmatched is not defensible under the stated human-confirmation policy. Use `ask`, not `deny`.
3. Project-scoped `.mcp.json` is defensible for reproducibility. Your measured `remove` result overturns the earlier assumption, but record the tested Claude version; it is implementation behaviour, not a stable contract.
4. The unfixed `setup` exposure still blocks shipping. Two stale exports are not necessarily two present-tense deliberate acts. Rewording “local by construction” is insufficient; `setup-local.ts` should strip `DATABASE_URL` and `DB_MIGRATE_ALLOW_REMOTE` from the migration child’s inherited environment.

`git diff --check` passed. Tests could not start in this read-only review sandbox because Vitest attempted to write `node_modules/.vite-temp`.