Land after fixes.

### Findings

- **F11 — P1 — FIXED:** [src/dig-deeper.ts:429](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/dig-deeper.ts:429). The library lookup was outside the search deadline, so it could outlive the 170-second allowance lease. The test `does not let a slow library query outlive the search step's deadline` failed first; the lookup now shares the combined deadline and preserves caller aborts.

- **F12 — P1 — FIXED:** [src/routes.ts:1698](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/routes.ts:1698), [src/store/pg-comments.ts:337](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/store/pg-comments.ts:337). Comment Dig deeper searched before atomically claiming its row, allowing two presses to buy two searches before one lost the claim. The test `claims the comment before searching, so two presses buy only one search` failed first. The route now claims against the exact previous answer state, preserves that answer during search, clears it only after successful search, and restores it on failure. The comment lease now covers search, answer, and margin.

- **F13 — P3 — FIXED:** [src/messages.ts:5297](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/messages.ts:5297). Rate-limit copy claimed “the answer you already have is still there,” which was false on a glossary term’s first press. The test `does not claim there is an earlier answer when the first glossary dig is refused` failed first.

- **F14 — P3 — FIXED:** [src/web/CommentDialog.tsx:653](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/CommentDialog.tsx:653). A successful search returning zero sources said they were “listed above.” The test `does not claim an empty sources list is shown above` failed first.

F1, F2, the reworded F4, F5, F7, F8, F9, and F10 are now satisfied. Forced-search success requires a positive usage witness; the answer model is directly pinned despite environment overrides; the stored model comes from the actual response; cached prefix components remain identical; all external and library text is fenced; and the glossary repeat/failure/visitor states are covered. Stage 1 has no `generationKey`; F3/F6 freshness work remains correctly scoped to Citations in stage 2.

Verification:

- 341 relevant unit tests passed.
- All four TypeScript projects passed, covering 2,575 source files. I invoked the same typecheck script with `node --import tsx` because the sandbox blocks the `tsx` CLI’s IPC socket.
- Import-cycle check and `git diff --check` passed.
- Biome reported informational existing complexity warnings only.
- Please rerun the Postgres-backed `dig-deeper-comment`, `term-lookup`, `glossary-lookup-stream-route`, and `glossary-stream-lifetime` suites; shared route/store/search code changed.

Changed files:

- [src/comments.ts](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/comments.ts)
- [src/dig-deeper.ts](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/dig-deeper.ts)
- [src/messages.ts](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/messages.ts)
- [src/routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/routes.ts)
- [src/store/contracts.ts](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/store/contracts.ts)
- [src/store/pg-comments.ts](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/store/pg-comments.ts)
- [src/web/CommentDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/src/web/CommentDialog.tsx)
- [tests/comment-dialog-search-the-web.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/tests/comment-dialog-search-the-web.test.tsx)
- [tests/dig-deeper-comment.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/tests/dig-deeper-comment.test.ts)
- [tests/dig-deeper.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/go-deeper/tests/dig-deeper.test.ts)

No commit was made.