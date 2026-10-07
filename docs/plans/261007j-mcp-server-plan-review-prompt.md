# Plan review: an MCP server for Spideryarn (261007j)

You are reviewing a **plan**, read-only. Candidate: the untracked file
`docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md` in this worktree (base: the current
`HEAD`). Nothing is built yet. Read `CLAUDE.md` for the house rules, then the plan.

Context you can read in the tree:

- `src/auth.ts` § `requireUser` (the gate), `src/routes.ts` (`serveApi`, `serveAuthenticatedApi`,
  `AUTH_ROUTES` ~line 8504; the admin prefix gate ~11690), `src/admin.ts` § `isAdmin`.
- The routes the tools wrap: `/api/library`, `/api/library/search`, `/api/library/tags`,
  `/api/library/:slug/tags`, `/api/jobs`, `/api/reader`, `/api/billing/usage`,
  `/api/article/:slug/visibility`, `/api/admin/users`, `/api/admin/vouchers`,
  `/api/admin/vouchers/:id`, `/api/admin/voucher-emails/:id/retry`. Parsers:
  `src/store/pg-vouchers.ts` (`parseNewVoucher`, `parseVoucherPatch`), `parseJobRequest` in
  routes.ts.
- `docs/project/security-map.md` (§ Where the defences physically live, and the private-link key
  section), `docs/project/auth.md`, `docs/project/email.md` (only production sends),
  `docs/project/feedback-reports.md` (an unattended run may not edit a listed defence).
- `src/web/lib/api.ts` § `apiFetch` (what the browser sends).

## What to attack, independently first

1. Is "a local stdio server that signs in with email+password and calls the existing HTTP API"
   actually free of any change to a listed defence, and actually as safe as the browser? Think
   about: the session file (refresh token on disk), refresh-token rotation with several server
   processes, the token reaching places it shouldn't (logs, tool output, error messages), and tool
   output carrying sensitive data into a model's context (e.g. other users' emails from
   `/api/admin/users` — acceptable for the admin's own agent?).
2. Is the tool list right for Greg's goal (an agent that trawls his email and then sends gift
   vouchers, imports articles, tags them, shares them)? Anything missing that is cheap and
   valuable, or anything included that shouldn't be (e.g. `get_allowance` claiming vouchers as a
   side effect; `set_visibility` making an article public from an agent)?
3. Safety of outward-facing tools: `create_gift_voucher` sends real mail in production. Is
   idempotency (client-minted uuid, replay) handled right for an agent that may retry? Are MCP tool
   annotations plus descriptions enough, or should creating a voucher take an explicit confirm
   argument?
4. Is deferring the private-link key (Question 2) right, or over-cautious given the owner already
   sees it on their own card?
5. Dependency choice: `@modelcontextprotocol/sdk` 1.x + `zod` vs hand-rolled JSON-RPC vs the 2.x
   packages.
6. The stages and their "done when": would stage 2's spike actually prove the "respects what each
   user may do" claim, or could it pass while broken (silent success)?
7. Question 1 options for remote auth: described correctly and fairly? Anything wrong in the
   Supabase OAuth server reasoning (audience binding; OAuth tokens reaching every route vs only
   `/api/mcp`)?

## My own suspicions (worth less; spend most of the run elsewhere)

- Whether Greg's Google-only production account can get a password via Forgot password.
- Whether `/api/library` returns tags and visibility at all, so `list_articles` may need a second
  call.

## Output

Severity scale: P0 (would cause harm or a defence breach), P1 (plan is wrong in a way that will cost
the stage), P2 (worth changing), P3 (nit). Give each finding an ID (F1, F2…), severity, the evidence
(file:line), and the change you propose. End with one line: `VERDICT: proceed`,
`VERDICT: proceed with changes`, or `VERDICT: rethink`.
