Review complete. No unresolved production defects remain in Stage 2, and nothing was committed.

### Findings

- **P0 — none.**

- **P1 — an uncertain retry could create two bookmarks.** The original callback minted a new ID each time. If Postgres committed but the response was lost, the optimistic row disappeared and the next press used a different ID. I added a per-block retry controller that retains the ID after an unconfirmed result and coalesces simultaneous presses: [block-bookmark.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/block-bookmark.ts:28), wired from [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/reader/Reader.tsx:1321). Red-first coverage proves both retry and double-press cases: [block-bookmark.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/block-bookmark.test.ts:25).

- **P2 — the failure announcement claimed more than the client knew.** “Couldn’t bookmark” was false when the server committed but its response was lost. It now says “Bookmark not confirmed”; success is still announced only after `create` resolves: [BlockGutter.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/BlockGutter.tsx:730).

- **P2 — the request-trace contract still expected the old comments URL.** The full suite would have failed, and there was no direct hook witness protecting the opt-in. Updated the trace expectations and added an exact URL test: [the-ideas-extraction-changed-no-requests.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/the-ideas-extraction-changed-no-requests.test.tsx:714), [use-comments-load-state.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/use-comments-load-state.test.ts:125).

- **P2 — several high-risk seams lacked direct whole-block witnesses.** Added coverage for the old/new owner GET split, database constraints, public SQL mapping, both export shapes, dialog/drawer JSX, and referee mirror. Examples: [routes.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/routes.test.ts:1406), [db-schema.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/db-schema.test.ts:238), [public-visibility-pg.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/public-visibility-pg.test.ts:928), [store-export-bundle.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/store-export-bundle.test.ts:594).

### Conclusions checked

The nullable-anchor sweep found no remaining unsafe production `Comment.quote`/`start` consumer. Remaining direct accesses are narrowed selection anchors or unrelated types. SQL mapping, raw/rollback exports, public projection, navigation, prose marking, follow-up chat, mirror, and the legacy answer route all handle the absent pair.

The owner’s only HTTP comments loader opts in at [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/useComments.ts:325); other server paths read the store directly and were checked. The public old-tab navigation risk remains the deliberately accepted one in the plan.

The migration is data-safe and its constraints are correct: existing rows remain unchanged, the pair constraint forbids both half-anchors, and the second constraint keeps quote-less rows at `status='none'`: [migration SQL](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/drizzle/20260912154746_comments_whole_block_bookmark.sql:1). Operationally, adding the checks scans/locks the comments table; it is not a zero-lock migration, though the current table size makes that a small risk.

### Verification

- Red test observed before the retry helper existed.
- `13` affected non-database test files: **297 passed**.
- `node scripts/typecheck.ts`: **passed**, all 2,154 source files covered.
- `npm run db:chain`: **passed**.
- `git diff --check`: **passed**.
- Lint scanned 2,468 files; the repository’s advisory baseline remains red with 175 errors, principally existing complexity findings.
- Database-backed rerun could not start because this sandbox forbids connection to `127.0.0.1:54362` (`EPERM`). The newly added route, constraint, public-reader, and export database assertions therefore remain to be run outside this sandbox.
- Full suite was not run.