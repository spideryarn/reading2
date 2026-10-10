You are reviewing and FIXING code in this repo (Spideryarn), in the worktree you are running in.

Candidate: commit 4ab35b277 (parent aae49bf8d). Diff: `git show 4ab35b277`; paths: `git diff --name-only aae49bf8d 4ab35b277`. Start with
src/web/add-author-gift.ts, src/web/AddAuthorGift.tsx, src/web/AddPage.tsx (the new `leave` transition and the `gift` phase),
src/web/AdminAuthorGifts.tsx, src/web/useAdminAuthorGifts.ts, src/web/admin-vouchers-parts.tsx, src/web/AdminVouchersPage.tsx,
src/mcp/tools.ts, and the new tests; this does not limit scope.

Plan: docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md (§ Revision 3 wins), in particular D9, D10, D6 (notes, MCP) and
R2-F2, R2-F7, R2-F8. The server it talks to is already reviewed (docs/plans/261009u-code-review-1-sol.md): src/routes.ts
(ADMIN_AUTHOR_GIFTS_PATH), src/admin-author-gifts.ts, src/store/pg-author-gifts.ts. Read docs/project/ingest-queue.md § The add page (the
three traps in a page whose whole job is one effect) and docs/project/high-powered-ai.md § Switching it on while the article is added.

Fix what is inside this commit, narrowly and red-first (a test that fails, then the fix). Report — do not fix — anything wider. Do not
commit. Nobody else is editing these files now.

Attack independently first: the add page's exits (is behaviour byte-for-byte unchanged when not armed? can the armed path send twice,
send with another reader's token, navigate after the reader/source changed, or strand the page with no way out?), the sharing-unsettled
interplay, the admin page's polling (bounded? at rest costs nothing?), Edit/notes races with a lookup filling fields, Send confirmation and
disabled states, found-not-applied correctness, the private key never reaching the page or MCP, MCP tools admin-only and non-sending,
accessibility of the new controls, and words a reader/Greg would misread.

You can run vitest on any of these test files yourself (they are jsdom/unit, no database): tests/add-author-gift.test.ts,
tests/add-page-author-gift.test.tsx, tests/admin-author-gifts.test.tsx, tests/admin-vouchers-page.test.tsx, tests/mcp-tools.test.ts,
tests/add-*.test.ts*, and `npm run typecheck`.

Severity: P0 data loss/exploitable security/incorrect charging/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2
design risk; P3 prose. Output: verdict line (APPROVE / APPROVE WITH CHANGES / REJECT), then findings C1, C2…, severity, file:line, and
"FIXED (files, test)" or "REPORTED". List every file you changed at the end.
