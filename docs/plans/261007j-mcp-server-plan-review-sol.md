The plan should not proceed as written. The local-server direction is sound, but its two outward-facing actions rely on advisory client behavior, and voucher retries are not actually idempotent.

### Findings

**F1 — P0 — Tool annotations do not safely authorize mail, publication, or disclosure of user data**

Evidence: [plan:149-156](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:149), [security-map.md:19-23](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/project/security-map.md:19), [admin.ts:230](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/admin.ts:230).

The intended agent reads untrusted email and article text, while receiving tools that expose other readers’ emails, send real mail, and publish articles. A malicious email or article can instruct the model to use those capabilities. MCP explicitly defines annotations such as `destructiveHint` as hints—not enforcement—and notes that clients vary in how they use them. [MCP tool-annotations guidance](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/blog/content/posts/2026-03-16-tool-annotations.md)

An explicit `confirm: true` argument is useful UX, but is not a security boundary: the model can supply it itself.

Change: remove `set_visibility(public)`, `create_gift_voucher`, voucher-email retry, and `list_users` from the initially unattended tool set. Add preview/read-only tools first. Reintroduce outward actions only behind a host-enforced human approval that the tool server can verify, or an out-of-band single-use approval. Treat every MCP result as untrusted model input, minimize user data, and explicitly decide whether other readers’ emails may be sent to the chosen model provider.

**F2 — P0 — Voucher creation is not idempotent across an agent retry**

Evidence: [plan:152-153](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:152), [pg-vouchers.ts:410-425](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/store/pg-vouchers.ts:410), [pg-vouchers.ts:435-499](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/store/pg-vouchers.ts:435), [routes.ts:8547-8561](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/routes.ts:8547).

The database safely replays the same voucher UUID and body. But the proposed tool mints the UUID internally. If the HTTP call succeeds and the MCP result is lost, a second tool invocation mints a new UUID, producing a second voucher and potentially a second real email.

Change: require a caller-supplied stable `idempotency_key`/voucher UUID, return it in previews and results, and document that retries must reuse it. Test a lost-response replay and assert one voucher and one queued delivery. A persisted operation ledger would be stronger where the MCP client cannot reliably reuse arguments.

**F3 — P1 — The session store is a new defence and is less safe than the browser design**

Evidence: [plan:109-131](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:109), [auth.md:110-149](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/project/auth.md:110), [api.ts:557-611](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/web/lib/api.ts:557), [api.ts:628-686](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/web/lib/api.ts:628).

A Bearer token that passes `requireUser` has the same server permissions, but that does not make the client equally safe. The browser binds refresh/retry to the same reader. The proposed shared file has no locking, atomic replacement, owner validation, or concurrency design. Supabase refresh tokens normally rotate; concurrent processes can overwrite the newest session or eventually revoke the session when reuse falls outside its permitted window. [Supabase session semantics](https://supabase.com/docs/guides/auth/sessions)

`0600` also does not cover parent-directory permissions, symlink replacement, crash-safe writes, or tokens escaping through stderr/tool errors.

Change: call this a new authentication defence. Specify a `0700` directory, owner/type checks, inter-process locking, read-latest-under-lock refresh, atomic replacement, and logout behavior. Add concurrent-refresh tests plus token sentinels proving access and refresh tokens never appear in stdout, stderr, tool results, logs, or errors. The statement that copying a browser token simply “signs the browser out” should be replaced with the actual rotation/reuse behavior.

**F4 — P1 — The dependency decision selects the legacy SDK**

Evidence: [plan:100-105](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:100).

The official TypeScript SDK now describes the split 2.x packages as stable and 1.x as the legacy branch receiving temporary fixes. Version 2 implements the current protocol and accepts Standard Schema validators, including Zod 4. [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

Change: use `@modelcontextprotocol/server` 2.x with Zod 4. Do not hand-roll JSON-RPC. Use 1.x only if a concrete compatibility test reveals a blocker, and record that blocker.

**F5 — P1 — Remote OAuth is framed as a later routing detail, but it determines the architecture**

Evidence: [plan:79-85](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:79), [plan:202-219](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:202), [auth.ts:302-358](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/auth.ts:302).

`requireUser` checks identity and role, but not MCP resource audience, `client_id`, or scopes. MCP authorization requires resource-bound tokens and forbids passing the MCP token through to a different upstream service. [MCP authorization specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/basic/authorization.mdx)

Therefore:

- Binding the token to `/api/mcp` conflicts with forwarding it to `/api/*`.
- Letting it reach every API route grants the connector access beyond its advertised tools.
- “Gives up nothing” understates Supabase OAuth’s beta status and the work around consent, audience, scopes, revocation, and redirect/DCR validation. [Supabase OAuth server guide](https://supabase.com/docs/guides/auth/oauth-server/getting-started)

Change: design remote MCP as one audience-bound `/api/mcp` boundary that dispatches internally using an already verified user—not by replaying the OAuth Bearer token to HTTP routes. Extract shared service operations beneath the routes. Decide scopes before presenting Supabase OAuth as the recommendation.

**F6 — P1 — Stage 2 can pass without proving its main safety claim**

Evidence: [plan:180-195](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:180), [security-map.md:48-51](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/project/security-map.md:48).

One reader being denied `/api/admin/*`, while each reader can list some shelf, does not prove exact owner isolation, safe refresh, output redaction, or idempotency. Production returning 401 without credentials proves only that the public gate exists; it does not prove Greg can authenticate.

Change: seed distinct canary articles, tags, and jobs for two readers and assert exact presence and absence for every scoped tool. Test swapped tokens, every admin tool under both identities, concurrent refresh, lost-result voucher replay, and token-output sentinels. Deliberately break one gate/expected canary and watch the harness fail. Make successful production password login plus a read-only call an explicit prerequisite; the existing docs show reset mail delivery but not that Greg completed password setup ([email.md:39-43](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/project/email.md:39)).

**F7 — P1 — `set_visibility` specifies the wrong body and treats a human attestation as agent data**

Evidence: [plan:148](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:148), [routes.ts:5932-6026](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/routes.ts:5932).

The route requires `rightsConfirmed`, not `rights_confirmed`; implementing the plan literally returns 400. More importantly, that field attests that the owner has the right to republish someone else’s full text. A model-generated `true` does not establish that.

Change: initially expose only unpublishing. If publishing is restored, use the correct API field and require separately verified human approval of that specific article and visibility change.

**F8 — P2 — Two “read” tools have misleading or unnecessarily broad behavior**

Evidence: [plan:140](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:140), [plan:149](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:149), [routes.ts:11447-11487](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/routes.ts:11447), [admin.ts:230-289](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/admin.ts:230).

`get_allowance` may claim vouchers and queue email; it is not read-only. `list_users` exports every reader’s email and account metadata into model context and is not needed to create a voucher—the server already determines whether a recipient has an account.

Change: omit `get_allowance` for the exempt admin, or rename it `sync_and_get_allowance` and annotate its effects accurately. Omit `list_users` from V1, or replace it with a narrowly scoped lookup only after an explicit privacy decision.

**F9 — P2 — `list_articles` cannot report active and archived articles with the described single request**

Evidence: [plan:135-143](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:135), [routes.ts:8863-8877](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/routes.ts:8863), [pg.ts:2359-2366](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/store/pg.ts:2359), [types.ts:2184-2339](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/src/types.ts:2184).

The library response does contain tags and visibility, so that suspicion is resolved. But the endpoint returns either active articles or archived articles depending on `?archived=1`; an ordinary response has no per-item archived flag.

Change: give `list_articles` an `archive: "active" | "archived" | "all"` input. For `all`, make two requests and add the derived flag. Remove the blanket “each tool is one route” claim.

**F10 — P2 — The personal-key remote option is described unfairly**

Evidence: [plan:220-227](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:220).

Claude’s current custom-connector documentation supports fixed request headers/API keys; Team and Enterprise share that credential among users of the connector. [Claude custom connector documentation](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

Change: present the option as viable and simplest for a Greg-only connector, but unsuitable for per-reader identity or a broadly shared organization connector. Question 1 should choose among:

- local stdio for one machine;
- fixed credential for one trusted admin remotely;
- OAuth for genuine multi-reader use.

**F11 — P3 — The source feedback link is broken**

Evidence: [plan:10](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md:10).

`docs/user-feedback/261006_2227-mcp-server-for-spideryarn.md` is absent from this worktree.

Change: add the report before tracking the plan, or remove/correct the link.

Deferring the private-link key is correct. The security policy explicitly limits where that bearer secret may travel ([security-map.md:262-279](/var/tmp/spideryarn-worktrees/fbbkkjzy-mcp-server/docs/project/security-map.md:262)); showing it on the owner’s `no-store` browser card does not authorize placing it in a model conversation or another vendor’s retention boundary.

VERDICT: rethink