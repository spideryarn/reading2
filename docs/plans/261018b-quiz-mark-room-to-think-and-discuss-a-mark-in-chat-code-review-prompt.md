You are the code reviewer for one change in the Spideryarn repo (this worktree, branch at HEAD).

The plan: docs/plans/261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat.md (read it, and
its plan review docs/plans/261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat-plan-review-sol.md).

The change is the last commit: `git show HEAD` (scope: src/quiz-mark.ts, src/ai-call.ts,
src/types.ts, src/routes.ts, src/web/chat-handoff.ts, src/web/QuizPanel.tsx,
src/web/modes/conversation/ConversationModes.tsx, src/web/reader/Reader.tsx, three test files, two
docs).

Review for correctness bugs, things the plan says that the code does not do, and tests that would
pass on a broken implementation. In particular:
- does the mark request really send max_tokens 4,000, and does anything else (spend estimates,
  billing pre-checks, cost declarations, timeouts) key off the old 1,200?
- does the Discuss button's press reach Chat's composer as an unsent draft from
  ?mode=learn&learn=quiz (handToChat with "wait"), and is it absent for visitors?
- is the button drawn only on a whole mark, and is the seed built from the answer the mark was
  computed on, not the edited box?
- does the IconButton/Tooltip/ControlTip usage match its neighbours in the step row (accessibility,
  touch)?

You may fix what you find inside this scope: edit the files, and run `npx vitest run <files>` and
`npm run typecheck`. Do not commit. Do not touch anything outside the scope; report wider concerns
instead.

Write your answer as: a numbered list of findings (severity, file:line, what, and whether you fixed
it), then the list of files you changed, then a one-line verdict: SHIP, SHIP AFTER FIXES (made), or
DO NOT SHIP.
