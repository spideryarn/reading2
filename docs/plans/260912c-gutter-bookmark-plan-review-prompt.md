You are reviewing a PLAN (read-only) in the spideryarn2 repo, worktree at the current directory.

Read docs/plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md in full, then the code it names:
src/web/BlockGutter.tsx, src/web/styles/gutter.css (§ the gutter and § What "…" opens), src/types.ts
(`Comment`, `ChatAnchor`), src/db/schema.ts (the `comments` table), src/store/pg-comments.ts,
src/routes.ts (`createFree`, the legacy answer path), src/store/public-reader.ts, src/public/dto.ts,
src/web/TableView.tsx (anchorKey, resolveAnchors, the BlockGutter call), src/web/comment-nav.ts,
src/web/CommentDialog.tsx, src/web/Dock.tsx (the comment list), src/web/reader/Reader.tsx (the
annotate save and the follow-up handoff), src/referee-mirror.ts, docs/project/comments.md.

The conclusions I would least like to be wrong about:

1. That the second "…" Greg saw is the disclosure button itself, drawn by
   `.blk-gutter[data-open] > *`, and that hiding it while open (`display: none`) is safe for keyboard
   and screen-reader users given Escape and the focus handling in BlockGutter.tsx.
2. That option B (a comment with no quote/start — a whole-block bookmark) is the right call over A
   (store the whole paragraph as the quote), and that the list of places it touches is complete.
   Specifically hunt for consumers of `Comment.quote` / `Comment.start` that the TypeScript compiler
   will NOT flag when they become optional (JSX rendering, string templates, `?.`, JSON export,
   SQL predicates, tests/fixtures, the public DTO / public-reader SQL, the export bundle, the
   store-parity or migration-witness tests, anything that compares anchors).
3. That the migration (quote/start nullable together; quote-less implies status 'none') is safe and
   additive for production, and that nothing in the legacy answer path, `sweepPending`, `linkThread`
   or the public read can be reached by a quote-less row in a way that breaks.
4. That putting the affordance third (after permalink and chat, before "?"), drawn only when the block
   has no comment, is coherent with the container-query slot arithmetic keyed on `data-controls`.

Report findings ranked by severity (P0/P1/P2), each with file:line evidence and a concrete fix. Say
plainly if you think a simpler design would serve Greg better. Do not edit any files.
