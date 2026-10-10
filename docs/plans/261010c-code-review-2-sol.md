APPROVE WITH CHANGES

C1 — P1 — [AdminAuthorGifts.tsx:321](/var/tmp/spideryarn-worktrees/author-gift/src/web/AdminAuthorGifts.tsx:321) — Notes could overwrite lookup-appended text, and Send remained available while a lookup was running. Notes now detect newer content, pause during lookups, and explain why; Send waits for lookup completion with an accessible reason. FIXED (`AdminAuthorGifts.tsx`, `admin-author-gifts.test.tsx`).

C2 — P1 — [AdminAuthorGifts.tsx:465](/var/tmp/spideryarn-worktrees/author-gift/src/web/AdminAuthorGifts.tsx:465) — Draft fields, starter selection, and rights confirmation remained editable during writes; those late edits were then silently discarded. All affected controls are now locked in flight. FIXED (`AdminAuthorGifts.tsx`, `admin-vouchers-parts.tsx`, `admin-author-gifts.test.tsx`).

C3 — P1 — [AddPage.tsx:257](/var/tmp/spideryarn-worktrees/author-gift/src/web/AddPage.tsx:257), [useAdminAuthorGifts.ts:174](/var/tmp/spideryarn-worktrees/author-gift/src/web/useAdminAuthorGifts.ts:174) — Malformed 2xx responses were accepted as success, allowing the add page to navigate or the admin page to claim an email was queued. Responses now require the documented status/body pair. FIXED (`AddPage.tsx`, `useAdminAuthorGifts.ts`, `add-page-author-gift.test.tsx`, `admin-author-gifts.test.tsx`).

C4 — P2 — [tools.ts:177](/var/tmp/spideryarn-worktrees/author-gift/src/mcp/tools.ts:177) — `list_author_gifts` spread the route object into MCP output. A future route field such as a private-link key would therefore leak into the conversation. MCP output is now explicitly allow-listed, with a sentinel credential regression test. FIXED (`src/mcp/tools.ts`, `tests/mcp-tools.test.ts`).

C5 — P2 — [add-author-gift.ts:140](/var/tmp/spideryarn-worktrees/author-gift/src/web/add-author-gift.ts:140) — Raw internal exception messages could reach the reader. Only deliberately reader-facing errors are now shown; internal failures use the standard page-fault copy. FIXED (`add-author-gift.ts`, `add-author-gift.test.ts`).

C6 — P3 — [AddAuthorGift.tsx:35](/var/tmp/spideryarn-worktrees/author-gift/src/web/AddAuthorGift.tsx:35) — Both entry points promised “one web search,” although the lookup may use three. The copy now says “up to three searches.” FIXED (`AddAuthorGift.tsx`, `AdminAuthorGifts.tsx`, related tests).

C7 — P1 — [pg-author-gifts.ts:651](/var/tmp/spideryarn-worktrees/author-gift/src/store/pg-author-gifts.ts:651) — A notes PATCH still replaces the whole field without a version precondition. The client fixes prevent known same-page lookup races, but another tab or MCP write can still overwrite a concurrent edit or lookup append. This needs server-side optimistic concurrency or an append operation. REPORTED; wider than this client/MCP commit.

Verification:

- 19 requested/add-related test files: 641 tests passed.
- Final focused admin suite: 26 tests passed.
- All four TypeScript projects and source-coverage validation passed via `node scripts/typecheck.ts`. The npm wrapper itself could not create its `tsx` IPC socket in this sandbox.
- Biome lint: no errors; three advisory complexity notices.
- `git diff --check`: passed.
- No commit made.

Files changed by this review:

- `src/mcp/tools.ts`
- `src/web/AddAuthorGift.tsx`
- `src/web/AddPage.tsx`
- `src/web/AdminAuthorGifts.tsx`
- `src/web/add-author-gift.ts`
- `src/web/admin-vouchers-parts.tsx`
- `src/web/useAdminAuthorGifts.ts`
- `tests/add-author-gift.test.ts`
- `tests/add-page-author-gift.test.tsx`
- `tests/admin-author-gifts.test.tsx`
- `tests/mcp-tools.test.ts`

The unrelated documentation and screenshot artifacts already present in the worktree were not changed.