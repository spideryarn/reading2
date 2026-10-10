You are reviewing code, write-capable, in the Spideryarn repo (this working tree). Fix what you find inside
this change; report anything wider for the author to decide.

The plan, with your own plan review folded in: docs/plans/261010r-mcp-gift-any-article-and-send-makes-the-link.md
(your plan review is docs/plans/261010r-plan-review-sol.md). The change, as a diff against HEAD:
docs/plans/261010r-code-review.diff. Read the touched files in full where the diff is not enough:
src/store/pg-author-gifts.ts (ensureAuthorGift, resolveGiftStarter, listAuthorGifts, parseSendAuthorGift,
sendAuthorGift), src/store/voucher-starter.ts, src/store/pg-vouchers.ts (createVoucher and its resolveStarter
dep), src/store/pg-share-link.ts, src/routes.ts (the author-gift routes), src/web/AdminAuthorGifts.tsx,
src/web/useAdminAuthorGifts.ts, src/mcp/tools.ts (INSTRUCTIONS, draft_author_gift), src/mcp/server.ts.

What it does: an agent's `draft_author_gift` (makeLink: false) now drafts a gift for a private article with no
private link; the /admin/vouchers Send confirmation shows a rights tick when `starter.linkable` is false; Send
with `rightsConfirmed: true` makes the private link (keepExisting) only on a fresh freeze, then creates the
voucher; Send resolves the starter only if it is still the gift's own article; both MCP servers send
`instructions`.

The bounds: no MCP tool may reach Send or the rights tick; a model never records a sharing-rights confirmation;
nothing sends mail without the admin's press; the private link's key is never selected outside
src/store/pg-share-link.ts (tests/share-link-token-stays-home.test.ts) and never reaches a response, log or
MCP result; nothing makes an article public.

Look hardest at: ordering and races inside sendAuthorGift (freeze, expected check, link step, createVoucher,
starter-refused unfreeze, replays); whether the link step can run as the wrong owner or for the wrong article;
error paths that leave a gift frozen; the UI's tick state across refreshes/polls and a second confirmation; the
409 wording paths in routes.ts; whether INSTRUCTIONS is true for both servers; tests that pass for the wrong
reason.

Gates you can run: `npm run typecheck`; `npx vitest run tests/author-gifts.test.ts tests/admin-author-gifts.test.tsx
tests/mcp-tools.test.ts tests/mcp-remote.test.ts tests/voucher-starter-races.test.ts
tests/share-link-token-stays-home.test.ts` (the local Supabase is running). Do not commit, push, deploy, or touch
any remote database.

Write your findings to the answer file as a numbered list: severity, file:line, what is wrong, and whether you
fixed it (and how) or are reporting it. End with a verdict line: LAND, LAND AFTER FIXES, or DO NOT LAND.
