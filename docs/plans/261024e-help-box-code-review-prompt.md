Code review, in this worktree, of the uncommitted change for plan docs/plans/261024e-help-box-grows-with-its-words-and-a-costed-history.md (read it, and its plan review docs/plans/261024e-help-box-plan-review-sol.md).

The diff: `git diff HEAD -- src/web/help/HelpAsk.tsx src/web/useFitTextarea.ts tests/help-one-box.test.tsx docs/project/help-page.md`.

1. Help's signed-in box (HelpAsk.tsx § AskBox) now calls useFitTextarea and is resize-none overflow-hidden.
2. The shared hook useFitTextarea now clears the inline height when the box is empty (rows decide), as ChatPanel.tsx's composer does. Check every caller of useFitTextarea (FeedbackSendBox.tsx, AddPage.tsx twice, QuizPanel.tsx) and their CSS for anything this changes for the worse — e.g. a caller relying on the inline height when empty, a CSS min-height, a box emptied after being tall.
3. The test in tests/help-one-box.test.tsx § "grows with its words".

You may fix what you find inside these files (workspace-write); report anything wider for me to decide. Run `npx vitest run tests/help-one-box.test.tsx tests/quiz-panel.test.tsx` and `npm run typecheck` after any edit. Report numbered findings with severity and file:line, and list every edit you made. Say plainly if you find nothing.
