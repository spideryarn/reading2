No P0s. I found one P1 race and several P2 correctness/test gaps, all fixed. Nothing serious remains unresolved.

## Findings

- P1 — fixed: `bookmarkBlock`’s snapshot was incomplete and was mutated during render. It omitted the Comments drawer, Marginalia, modes, Remember sub-modes, native dialogs, and interactive hover cards. A render-time ref write could also publish state from an abandoned concurrent render. The snapshot is now committed in `useLayoutEffect`, covers the missing Reader surfaces, and separately detects newly opened/retargeted DOM dialogs and cards. A card merely closing does not incorrectly cancel the requested dialog. [Reader.tsx:2042](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/reader/Reader.tsx:2042)

- P2 — fixed: CommentDialog’s `blockRef` used the same render-time mutation pattern. It now updates after commit. Excluding `<body>` is an improvement, not a regression: gutter and `?note=` arrivals return to the block mark; deleting the last comment falls back to Comments; swapping/deleting into another comment keeps the dialog mounted, so the close cleanup does not run. [CommentDialog.tsx:218](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/CommentDialog.tsx:218)

- P2 — fixed: “Comment + AI reply” was false for pending and failed legacy attempts. The shared label is now “Comment + AI,” which accurately covers pending, failed, completed, and chat-backed involvement. [comment-nav.ts:197](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/comment-nav.ts:197)

- P2 — fixed: the visitor documentation incorrectly said every projected non-answer became a Comment. The public allowlist removes `status` and `threadId`; therefore a projected item with words is a Comment, one with a legacy answer is Comment + AI, and a wordless modern item becomes a Bookmark and is omitted from Marginalia. [public DTO:933](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/public/dto.ts:933), [comments.md:869](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/docs/project/comments.md:869), [marginalia.md:59](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/docs/project/marginalia.md:59)

- P2 — fixed: the render-budget test did not actually open Marginalia, so it could pass while `marginNotes` returned `null`. It now asserts Marginalia has space before asserting zero TableView renders. The dependency chain is stable: `askedList` is memoized, while `jumpTo`, `openChatThread`, and the URL setters are stable callbacks. [Reader.tsx:1806](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/reader/Reader.tsx:1806), [quiz-in-prose.test.tsx:568](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/tests/quiz-in-prose.test.tsx:568)

The gutter integration test now non-vacuously covers the POST payload, successful opening, chat/mode/drawer/hover-card races, hover-card closure, focus return, failed storage, and retry identity reuse. The mode and drawer cases failed against the reviewed implementation before the fix. [a-gutter-bookmark-opens-the-comment-box.test.tsx:297](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/tests/a-gutter-bookmark-opens-the-comment-box.test.tsx:297)

Verification:

- Touched test set: 5 files, 65 tests passed.
- Focus and public-reader regression set: 3 files, 88 tests passed.
- `npm run typecheck` was attempted but the managed sandbox blocked `tsx`’s IPC socket with `EPERM`. Running the same script as `node --import tsx scripts/typecheck.ts` passed all four projects and confirmed all 2,756 source files are covered.
- Biome reported no errors, only the existing informational complexity findings in `Reader` and `CommentDialog`.
- No full suite, commit, or git-state mutation performed.