You are reviewing a plan before it is built, in the Spideryarn repo (this working tree). Read-only.

Plan: docs/plans/261002j-visible-bookmark-comment-without-ai-and-comment-kinds-in-the-margin.md

Read it, then read the code it touches and check its claims against the code, especially:
- src/web/BlockGutter.tsx (the mark `.blk-cmt`, the bookmark button), src/web/styles/gutter.css
- src/web/block-bookmark.ts and its use in src/web/reader/Reader.tsx (`bookmarkBlock`, `openCommentDialog`, `askedList`, `openAskedFromDrawer`, the `marginNotes` memo)
- src/web/CommentDialog.tsx (focus on mount, CommentBody, the follow-up box)
- src/web/marginalia/notes.ts and MarginaliaColumn.tsx (`CommentNote`, `ShutNote`), src/web/marginalia/tips.ts
- src/web/comment-nav.ts (`AskedQuestion`, `orderDrawer`), src/web/useChatAnchors.ts (`askedQuestions`), src/web/Dock.tsx (the Comments drawer rows)
- docs/project/comments.md, docs/project/marginalia.md, src/public-types.ts (what a visitor's comment carries)

Questions:
1. Is the three-way kind derivation (threadId / status / askedQuestions) correct and complete? Any comment state that gets the wrong label? Is the claim "no stored field needed" right?
2. Opening the CommentDialog after a bookmark press: races (optimistic row vs confirmed id, a second press, the reader opening something else meanwhile, a failed write), focus restoration (the opener button disappears), and the iPad.
3. Questions in the margin: owner-only gating, staleness (a thread whose block is gone), and whether `openAskedFromDrawer` is safe to call from the margin in every mode.
4. Anything simpler that gives Greg the same thing.
Give findings as P0/P1/P2 with file:line evidence, and say plainly if you find nothing serious. Write nothing to the tree.
