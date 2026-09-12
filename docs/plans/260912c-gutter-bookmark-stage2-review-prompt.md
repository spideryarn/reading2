Code review of STAGE 2 of docs/plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md, in the
spideryarn2 worktree at the current directory. Read the plan in full first — especially § What the plan
review changed, which records your own plan review (docs/plans/260912c-gutter-bookmark-plan-review-sol.md)
and what was done about each finding.

The change is UNCOMMITTED on top of commit 3a01a607 (stage 1). Scope it with
`git diff HEAD --stat` and `git diff HEAD -- <file>`; new files: drizzle/20260912154746_comments_whole_block_bookmark.sql
and its snapshot/journal entry. Do NOT use `git diff <fork-point>`.

What it does:
1. A one-press "bookmark this paragraph" button in the gutter (BlockGutter.tsx `.blk-bookmark`, onBookmark),
   drawn only when the block has no comment, third after permalink and chat, before "?"; gated in Reader.tsx
   on `owner.comments.loaded && loadError === null`.
2. It stores a WHOLE-BLOCK comment: no quote, no start. `CommentAnchor` union in src/types.ts
   (`{quote: string; start: number} | {quote?: never; start?: never}`); `Comment`, `NewComment`,
   `NewCommentInput`, `PublicComment`, `ClientComment`, `Placement` rebuilt on it.
3. Migration: quote/start nullable, `comments_anchor_pair`, `comments_whole_block_is_free`. Applied locally.
4. Route: `createFree` accepts `{ blockId }` alone, refuses half a pair; `GET /api/comments/:slug` omits
   quote-less rows unless `?anchors=whole-block` (old open tabs crash on `c.quote.length`); the client sends it.
5. Consumers: pg-comments row mapping and create; public-reader and dto projections; TableView anchorKey and
   resolveAnchors (no prose mark); comment-nav ordering (whole-block first in its block) and `passageOf`;
   CommentDialog and the Dock drawer show "Whole paragraph — <opening words>"; Reader's follow-up handoff
   uses ChatAnchor's `{ blockId }` arm; referee-mirror uses the block text; the legacy answer route guards
   an unreachable quote-less row.
6. Stage 1 reversed per your plan review: the open column's disclosure is now an ✕ ("Close paragraph
   controls") instead of being hidden by CSS.

Results so far: `npm run typecheck` exit 0. These 30 files pass (852 tests total across two runs):
tests/block-gutter.test.tsx tests/gutter-target-size.test.ts tests/comment-nav.test.ts
tests/opening-read-gates-writes.test.tsx tests/dock-questions-loading.test.tsx
tests/a-failed-comment-write-is-said-on-the-dock.test.tsx tests/the-dock-drawer-is-not-a-modal.test.tsx
tests/opening-a-comment-moves-focus-into-its-dialog.test.tsx tests/one-escape-closes-one-surface.test.tsx
tests/routes.test.ts tests/public-dto.test.ts tests/store-*.test.ts tests/comment*.test.ts
tests/export-route.test.ts tests/referee-mirror*.test.ts. The full suite has NOT been run yet. A browser pass
is running separately.

The conclusions I would least like to be wrong about:
- That no consumer of `Comment.quote` / `Comment.start` still assumes they exist in a way the compiler
  cannot see: JSX, template strings, JSON/export (src/store/export.ts's `compact`, export-bundle's raw rows),
  SQL predicates, anything comparing anchors, the chat Save & ask path, the glossary or search paths.
- That the `?anchors=whole-block` gate cannot hide a whole-block row from any NEW-code path that needs it
  (e.g. anything else that loads comments for the owner through another route), and that the public read
  path's risk (not gated) is as small as the plan claims.
- That the bookmark press cannot double-store (optimistic row, button disappears; idempotent same-id create)
  and that the gutter's live-region announcement cannot lie (it waits for `create`'s result).
- That the migration is safe on production data and the constraints are exactly right.

House workflow: you FIX what you find inside this stage's scope (edit the files; keep the house comment style —
reasons beside the code, Greg's words quoted), rerun the affected test files with `npx vitest run <files>` and
`node scripts/typecheck.ts`, and report anything wider for me to decide. Do not commit. Finish with findings
ranked P0/P1/P2 (file:line evidence), what you changed, and the test/typecheck results.
