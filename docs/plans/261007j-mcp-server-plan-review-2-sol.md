The revision closes F4, F5, F7, F9 and F10, and the private-link deferral remains sound. F1–F3 are not yet closed.

### Findings

**F12 — P0 — MCP elicitation is not proof of a human decision, and the bypass restores the original vulnerability**

Evidence: [plan:182](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:182), [plan:200](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:200), [core types:5390](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/node_modules/@modelcontextprotocol/core/dist/auth-Anm-lwWi.d.mts:5390), [client types:2136](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/node_modules/@modelcontextprotocol/client/dist/index.d.mts:2136), [server types:1491](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-D4NN8WsG.d.mts:1491).

`ElicitResult` is just client-supplied `{ action: "accept", content?: … }`. Any MCP client can register a handler that returns `accept` programmatically—the proposed in-memory test does exactly that. The SDK explicitly calls the returned values untrusted. A well-behaved Claude host may reserve this path for a human UI, but MCP itself does not establish that, so “the model cannot answer it” is false.

`--allow-without-asking` is a persistent, server-wide bypass based on an unverifiable assumption about the host. Once enabled, prompt-injected mail and publication calls proceed with no gate.

Change: remove that flag. Keep the dangerous tools unavailable until each intended host has been spiked and shown to render a non-model, per-call approval containing the exact operation. If approval must be independently enforceable, use an out-of-band, expiring, single-use approval bound to a digest of the tool name and normalized arguments.

**F13 — P0 — Mixing the idempotency key with the voucher body defeats the key’s safety property**

Evidence: [plan:205](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:205), [parseNewVoucher:512](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/store/pg-vouchers.ts:512), [createVoucher:439](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/store/pg-vouchers.ts:439), [replay comparison:486](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/store/pg-vouchers.ts:486).

With `id = uuid(contents + idempotency_key)`, retrying key `K` with even slightly different contents produces a new UUID. The database never sees an ID conflict, so it creates another voucher and queues another email. This bypasses precisely the existing body-comparison/409 defence.

Exact same arguments do replay. Afterward:

- Revoked but otherwise unchanged: `200 replayed`; it remains revoked.
- Claimed but otherwise unchanged: `200 replayed`; no new gift is made.
- Any compared field edited—email, count, either note or name: `409 conflict`.
- Revocation and claim state are not part of the comparison.

Change: require a stable operation key. Either pass a caller-minted UUID directly as the voucher `id`, or derive the UUID solely from `(site, creator, idempotency_key)`. The body must not affect that identity; changed contents under the same key must reach the existing 409 comparison. Define canonicalization and the UUID namespace. Test same-key/same-body, same-key/changed-body, lost response, revoke, edit and claim, always asserting one voucher and one queued delivery. If retries must still return 200 after edits, an immutable creation snapshot or operation ledger is required.

**F14 — P0 — The session design still permits a request begun as one reader to run as another**

Evidence: [plan:133](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:133), [auth.md:110](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/project/auth.md:110), [browser retry binding:662](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/web/lib/api.ts:662).

The one file is keyed only by site. `login` can replace it while a server process or tool call is waiting. The plan does not bind a tool invocation to the `sub`/session it began under, nor specify the browser’s rule that a 401 retry must use the same reader or not be sent. A queued write can therefore pick up a newly logged-in reader’s token.

Change: bind each server process and each tool invocation to the initial verified `sub` and preferably `session_id`. Re-read before sending and after refresh; if either changes, refuse the call. Add login-during-call and account-change-during-401-refresh tests.

**F15 — P1 — Filesystem coordination covers refresh only and has unsafe lock/logout semantics**

Evidence: [plan:138](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:138), [plan:141](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:141), [plan:148](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:148), [Supabase commit guard:5015](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/node_modules/@supabase/auth-js/src/GoTrueClient.ts:5015), [Supabase logout scope:4031](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/node_modules/@supabase/auth-js/src/GoTrueClient.ts:4031).

A refresh can race logout: logout deletes the file, then the in-flight refresh writes it back. Supabase’s own implementation has an explicit commit guard for this. Login can race similarly. All session mutations—not just refresh—need the same coordination.

A lock “stale after 30 seconds” is not mutual exclusion unless refresh has a shorter enforced timeout and unlock verifies ownership. Otherwise process B steals it, then process A can unlink B’s lock when A eventually finishes.

The direct logout request must also specify local scope; Supabase’s default is global, affecting every device. A revoked access JWT remains usable until expiry, so running MCP processes must notice the deleted/replaced session rather than keep a cached token. [Supabase sign-out documentation](https://supabase.com/docs/reference/javascript/auth-signout)

Change: lock login, refresh and logout; use owner-tagged acquisition/release and a safe stale-lock design; verify the existing directory as well as the file; use local logout; and test refresh/logout, stale-lock takeover and an already-running server after logout.

**F16 — P1 — The plan does not choose the correct elicitation API for the SDK version it selected**

Evidence: [plan:104](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:104), [modern client flow:1943](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/node_modules/@modelcontextprotocol/client/dist/index.d.mts:1943), [deprecated elicitInput:3164](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-D4NN8WsG.d.mts:3164), [inputRequired example:1467](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-D4NN8WsG.d.mts:1467), [request-state warning:1431](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/node_modules/@modelcontextprotocol/server/dist/createMcpHandler-D4NN8WsG.d.mts:1431).

In the selected 2026-era protocol, `elicitInput()` throws. Tools must return `inputRequired(...)`; the client fulfills it and retries the tool. The echoed `requestState` is attacker-controlled unless integrity-protected, and the approval must be bound to the exact normalized arguments.

Change: explicitly specify `inputRequired`, schema-aware `acceptedContent`, signed/verified request state containing the operation digest, expiry and nonce, and the SDK’s legacy shim for 2025-era clients. Test both negotiated eras and an altered-arguments retry.

**F17 — P2 — F8 was described rather than resolved, and the privacy boundary is inconsistent**

Evidence: [plan:164](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:164), [plan:174](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:174), [plan:215](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:215), [usage side effects:11455](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/routes.ts:11455), [voucher result fields:273](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/store/pg-vouchers.ts:273).

`get_allowance` still has a read-like name while claiming vouchers and potentially sending claim-notice email. That also contradicts “tools that send mail ask the human.”

Meanwhile `list_users` is deferred because it exports addresses and metadata, but `list_gift_vouchers` exports every recipient address, name, both notes, claimant address and account standing. “Greg typed them” does not remove the provider-retention or prompt-injection concern.

Change: omit or rename `get_allowance` and account for its mail side effect. Explicitly approve, trim, filter or defer the voucher-list data boundary just as the plan does for users.

**F18 — P3 — F11 remains unfixed despite the review section saying it was taken**

Evidence: [plan:9](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:9), [plan:315](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:315).

`docs/user-feedback/261006_2227-mcp-server-for-spideryarn.md` is still absent from this worktree.

VERDICT: rethink