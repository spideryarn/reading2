You are reviewing a plan, read-only, in the Spideryarn repo (this working directory). Read CLAUDE.md, then the plan
docs/plans/261010g-mcp-draft-gift-and-remote-tool-list-without-the-asking-tools.md, then the code it touches:
src/mcp/tools.ts, src/mcp/server.ts, src/mcp/remote.ts, src/store/pg-author-gifts.ts (ensureAuthorGift, parseEnsureAuthorGift,
parseAuthorGiftPatch, sendAuthorGift), the author-gift routes in src/routes.ts (search ADMIN_AUTHOR_GIFTS_PATH),
src/admin-author-gifts.ts, src/web/AdminAuthorGifts.tsx (the Send confirmation), src/web/AddPage.tsx and
src/web/useAdminAuthorGifts.ts (their use of the ensure answer), and docs/project/mcp.md. Background: plan 261010c.

Greg's request is quoted in the plan. Judge:
1. Is reusing author_gifts (article-bound drafts) for "an unsent draft gift voucher" the right call, versus a preview tool,
   or making article optional? Is passing over article-less drafts acceptable for v1?
2. Is putting initial fields and lookup:false into the ensure route correct and safe (races with an existing gift,
   with the lookup filling empty fields, the 201/202 contract with the add page and the Draft-a-gift button)?
3. The private-link rights confirmation: the tool sends rightsConfirmed:true on the admin's behalf and the plan moves the
   human confirmation to the Send dialog. Is that sound? Anything better and simple?
4. Remote tool list: omit tools with `ask` unless they declare a remote variant; update_gift_voucher's variant drops `email`.
   Any hole (e.g. a tool whose handler still reaches an asking path, the stdio server, tests that enumerate TOOLS)?
5. Anything missing from the tests, or simpler designs passed over wrongly.
Give numbered findings with severity (high/medium/low), each with the concrete fix, and a verdict APPROVE / APPROVE WITH CHANGES / REJECT.
Do not edit files.
