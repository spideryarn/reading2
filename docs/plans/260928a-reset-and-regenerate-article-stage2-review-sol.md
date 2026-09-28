Implemented the stage-2 review fixes without committing.

Findings:

- **F9 P1 — fixed:** stale-but-present extras were omitted because the client used `StageState.done` rather than the completed-run receipt. It now names stale extras and refreshes Metadata after any same-article job completes. [ResetArticle.tsx](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/web/ResetArticle.tsx:127)
- **F10 P1 — fixed:** regeneration plans disappeared after reload. Active resets and published resets with active successors are now recovered from `job.reset`.
- **F11 P1 — fixed:** FAQ, Illustrated, and Citations had no rerun row, so their progress and failures vanished. Missing watchers are now derived and rendered with shared job progress; failures remain visible.
- **F12 P1 — fixed:** cost copy understated Debate, Sketch, Illustrated, and the arc’s delayed model call. Kept/lost wording now also covers bookmarks, shelf/sharing state, PDFs, and lookup detachment. [ResetArticle.tsx](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/web/ResetArticle.tsx:301)
- **F13 P2 — fixed:** the Yes button described itself through an ancestor. The confirmation is now a semantic `fieldset`/`legend`, with prose-only `aria-describedby`; the checkbox remains properly labelled.
- **F14 P2 — reported:** `RESET_EXTRA_NAME` and server `RESET_ROLE` remain duplicate classifications, guarded only by a test. A later change should split the role policy into a client-safe leaf shared by both sides. [ResetArticle.tsx](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/web/ResetArticle.tsx:54), [reset.ts](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/reset.ts:45)
- **F15 P2 — reported:** the client still infers presence from `ranAt`, while the server uses non-null revision columns. They agree for normal revisions, but exact structural identity would require exposing the server’s presence list through metadata.

The experimental gate, engine-driven `/advance`, plain 409 sentence, request body, reload recovery, and Reload button are covered. Reload is honest and sufficient for replacing the article payload held by the tab.

Verification:

- Focused suite: **4 files, 42 tests passed**
- Relevant web/tests TypeScript projects passed
- Touched files lint-clean; diff check passed
- Full `npm test` could not start because the sandbox cannot connect to local Postgres. I did not start or modify the database.
- No commit made. Existing documentation changes were left untouched.

Following [silent-success.md](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/docs/reusable/silent-success.md), each behavioral regression was observed failing before its fix.

**Verdict: ACCEPT after fixes.** No unresolved P0/P1 findings.