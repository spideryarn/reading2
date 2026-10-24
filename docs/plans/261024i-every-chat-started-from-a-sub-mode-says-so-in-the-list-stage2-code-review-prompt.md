Code review of plan 261024i § Stage 2, as built: a Learn › Quiz mark discussed in chat now records
its origin (Greg chose option B on docs/user-feedback/questions/q-nvxfwx.md).

Read first: docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md, § "Stage
2, rewritten after Greg chose B" and § "GPT Sol's review of the rewrite, and what changed" (your plan
review is the -stage2-plan-review-sol.md beside it; F1 was deliberately not taken, and the plan says
why: judge that reasoning against the code, and say if it is wrong). The house recipe is
docs/project/chat-from-a-mode.md § Adding it to another mode.

The scoped diff: `git diff 19525911e HEAD -- . ':(exclude)drizzle/meta' ':(exclude)src/help-corpus.generated.json'`
(19525911e is origin/dev at the merge; nothing else is in it). The two migrations are
drizzle/20261024131907_chat_thread_origin_quiz.sql (hand-reordered: the unique constraint before the
key that needs it) and drizzle/20261024132149_chat_thread_origin_quiz_only_null_mode.sql. Both are
applied to the local database already; do not edit the first, which is applied — a fix to it is a new
migration (`npm run db:generate -- --name <what>`, then `npm run db:migrate`, reading its Target line;
it must say 127.0.0.1).

Look hardest at:
1. The route (src/routes.ts § the chat route's `sentOrigin`/`wantedOrigin`, `parseQuizOrigin`): every
   path from a request to a stored quiz origin, the 409 against an existing thread, retries and edits.
2. src/thread-origin.ts both ways, and every other reader or writer of the chat_threads origin columns
   (pg-chat.ts, export.ts, the seeder, anything selecting columns by name) — a column missed is lost silently.
3. The client: useQuiz.ts (attemptId through `done`, kept answers, `showKept`, `noteMark`),
   QuizPanel.tsx (markOrigin, markChat, the Discuss button hidden while a chat exists, the mark's line),
   Reader.tsx (`discussQuizMark`, `startQuizMarkChat`, `quizChats`, `openOrigin` → `openQuizAt`),
   ConversationModes.tsx pass-through. Does the way back from an open Quiz chat really land on the
   question (Chat's band → Learn › Quiz)? Does a Quiz row in Chat's list open in Chat, not Learn?
4. The CHECKs and the composite key against the union; anything else in the schema that lists origin
   modes or columns.
5. Anything a reader sees that is now wrong: help pages, copy, docs.

You may edit files in this worktree to fix what you find within this stage (that is the house
workflow: you fix, I read your diff and run the gates). Keep fixes in the style of the surrounding
code. Run the suites you touch: `npx vitest run <files>` and `npm run typecheck`. Do not run the full
suite, do not commit, do not push, do not touch any other database than the local one.

Output: numbered findings, each with severity (blocker / should-fix / nit), evidence (file:line),
and either "fixed: <what you changed>" or "not fixed: <why, and what you recommend>". Then a verdict.
