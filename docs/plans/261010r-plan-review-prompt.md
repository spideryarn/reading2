You are reviewing a plan, read-only, for the Spideryarn repo (this working tree). Plan:
docs/plans/261010r-mcp-gift-any-article-and-send-makes-the-link.md

Context to read: docs/project/mcp.md; docs/plans/261010i-mcp-draft-gift-and-remote-tool-list-without-the-asking-tools.md
(especially its F2, which this plan revisits); docs/project/admin.md § Author gifts; docs/project/security-map.md
(the remote MCP token section and the private-link section); src/mcp/tools.ts, src/mcp/server.ts, src/mcp/remote.ts;
src/store/pg-author-gifts.ts (ensureAuthorGift, listAuthorGifts, sendAuthorGift, parseEnsureAuthorGift,
parseSendAuthorGift); src/store/voucher-starter.ts; src/store/pg-share-link.ts; src/web/AdminAuthorGifts.tsx and
src/web/useAdminAuthorGifts.ts; the author-gift routes in src/routes.ts (grep ADMIN_AUTHOR_GIFTS_PATH).

The bounds the work must hold: nothing the MCP does may send mail or speak to the outside world without the admin's
own press; a model must never record a sharing-rights confirmation on the admin's behalf; making an article public
must follow docs/project/public-shelf.md and public-readable-sharing.md; no defence (auth, remote tool filter,
asking tools, origin gate) may be edited without the admin's decision.

Questions: Is D2 (Send makes the private link behind a rights tick on /admin/vouchers) sound — ordering inside
sendAuthorGift relative to the freeze, the expected check, runAsOwner, starter-refused unfreezing, and replays of a
frozen "sending" gift? Does D1 lose any check (e.g. the slug-race articleId check in ensureAuthorGift, which needs
a ready starter)? Can any path let an MCP tool reach the rights tick? Is `linkable` computable without selecting
share_token (tests/share-link-token-stays-home.test.ts)? Is D3 (server instructions) safe and supported by the MCP
SDK version in package.json? Anything missing for the admin's example to work end to end from ChatGPT? Is the
deferred list right, and is anything deferred that should be in this slice (or vice versa)?

Write findings as a numbered list, each with severity (high/medium/low), the evidence (file:line), and the change
you propose. End with a verdict line: APPROVE, APPROVE WITH CHANGES, or REJECT. Do not edit any file.
