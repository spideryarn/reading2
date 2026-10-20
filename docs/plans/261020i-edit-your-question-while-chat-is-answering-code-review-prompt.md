# Code review: edit your question while Chat is still answering

You are the code reviewer AND fixer for one stage, in this worktree. Review commit 9342b0ce2
(show it with git) against its plan, docs/plans/261020i-edit-your-question-while-chat-is-answering.md,
and your own earlier plan review, docs/plans/261020i-edit-your-question-while-chat-is-answering-plan-review-sol.md.

The change: in src/web/ChatPanel.tsx, the pencil on a question stays while an answer is arriving;
`ChatTranscript` now owns the open editor's state (`rewrite`, `rewriteRow`, `askRewrite`, the queued
effect), and `EditQuestion` is controlled. Ask again while busy stops the last answer via `onStop` and
the queued effect calls `onEdit` once `busy` goes false — unless the last row is `error`, or the row is gone.

Look especially at:
1. The queued effect in ChatTranscript: can it fire twice, fire against the wrong row, or never fire
   after a successful stop? `onEdit` identity changes, StrictMode double effects, a second Ask press.
2. `rewriteRow`'s fallback (same index, same words, role user): any case where it re-attaches to the
   wrong question, e.g. after delete-from, after a retry, after a send appended below, two identical
   questions.
3. Focus: `Turn`'s pencil-focus effect after the editor closes, now that the pencil exists while busy,
   and when `Turn` remounts on the id swap.
4. Anything wider the plan missed: ChatDialog / ConversationModes callers, Live, recovery.

Run the tests yourself (no network is needed for these):
  npx vitest run tests/learn-edit-asks-again.test.tsx tests/chat-delete-from-panel.test.tsx tests/chat-copy-answer.test.tsx tests/chat-turn-waiting-spinner.test.tsx
and `npm run typecheck`.

Fix what is inside this stage, narrowly and red-first (a test that fails before your fix). Do not
commit. Report, do not fix, anything wider. Severity: P0 (data loss/broken), P1 (wrong behaviour a
reader will hit), P2 (worth fixing), P3 (nit). Give each finding an ID (C1, C2…), file:line evidence,
and say whether you fixed it. End with the list of files you changed.
