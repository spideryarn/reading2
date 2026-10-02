You are reviewing code before it lands, in the Spideryarn repo (this working tree). You may edit: fix what you find inside this change, and report anything wider for me to decide.

The plan, including what changed after your plan review: docs/plans/261002j-visible-bookmark-comment-without-ai-and-comment-kinds-in-the-margin.md
Your plan review: docs/plans/261002j-plan-review-sol.md
The diff under review (commit HEAD): docs/plans/261002j-code-review.diff

Check, against the code itself rather than the comments:
1. `bookmarkBlock` in src/web/reader/Reader.tsx: the stale-intent guard (`surface`, `bookmarkPress`). Is the snapshot of what is open complete enough (are there other surfaces — Remember, a mode band, the comments drawer, a hover card — whose opening should also stop the dialog)? Is assigning `surface.current` during render safe under StrictMode / concurrent rendering here? Does a retry after a failed press still behave?
2. CommentDialog's focus fallback: the `<body>` exclusion also changes the delete path and the `?note=` arrival path. Is any of those now worse?
3. The margin memo moved below `openAskedFromDrawer`: does its dependency list now change identity on scroll or on every render (`openAskedFromDrawer` depends on `mode`, `askedList`, `jumpTo`)? A TableView redraw per render would be a performance regression; there is a render-count budget in the tests.
4. `commentKind` and the margin/drawer labels: any comment state labelled wrongly; the visitor projection.
5. The tests: does each one fail when what it guards is broken? tests/a-gutter-bookmark-opens-the-comment-box.test.tsx especially.
6. Anything in the docs (comments.md, marginalia.md) that now says something the code does not do.

Run `npx vitest run <files>` for the tests you touch and `npm run typecheck`. Do not run the full suite, do not commit, do not touch git state. Write your findings as P0/P1/P2 with file:line evidence, say which you fixed and how, and say plainly if you found nothing serious.
