# Plan review, round 2: an MCP server for Spideryarn (261007j)

Read-only. Candidate: the untracked file
`docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md` in this worktree, revised after your
round-1 review (`docs/plans/261007j-mcp-server-plan-review-sol.md`, verdict *rethink*). § Review
at the bottom of the plan says how each finding was taken. The rest of the context is as in
`docs/plans/261007j-mcp-server-plan-review-prompt.md`. `@modelcontextprotocol/server` 2.3.1 and
`@modelcontextprotocol/client` 2.3.1 are installed in `node_modules`; read their `.d.mts` files to
check claims about elicitation.

## What to attack

1. Does each round-1 fix actually close its finding, or only the sentence about it? In
   particular F1: is MCP elicitation a gate the model cannot pass (what does the client return,
   and could a model-controlled path produce an *accept*)? Is `--allow-without-asking` a sound
   opt-in, or a footgun?
2. F2: a voucher id derived from the gift's contents plus an optional `idempotency_key`, as a
   name-based UUID. Check it against `parseNewVoucher` and the replay/409 logic in
   `src/store/pg-vouchers.ts` — does an identical retry replay, and what happens after the voucher
   is revoked, edited or claimed and the same call is made again?
3. F3: is the session-file design (0700/0600, ownership checks, atomic rename, lock with
   re-read, no supabase-js) right and sufficient? Anything about Supabase refresh-token rotation
   it gets wrong?
4. Is anything new in the revision wrong, or is anything still missing for stage 1 to be built
   from this plan without guessing?

Same severity scale (P0–P3), IDs continuing from F12, evidence as file:line, and a final line
`VERDICT: proceed`, `VERDICT: proceed with changes`, or `VERDICT: rethink`.
