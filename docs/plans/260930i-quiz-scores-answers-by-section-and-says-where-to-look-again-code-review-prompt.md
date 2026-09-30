# Code review: quiz says where to look again (260930i)

You are reviewing built code, and you may FIX what you find inside this change's scope. Repo:
Spideryarn, an AI-assisted reading app. You are in a git worktree; do not commit, push, stash,
reset or switch branches — edit files only.

The change is `git diff 7396a059 HEAD` (one commit, e34acf14). Read the plan first, including its
"After GPT Sol's plan review" section — that list is what was meant to be built:
docs/plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again.md
Your own plan review is docs/plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again-review-sol.md.

Check the code against the plan and against the code around it, not the prose:
- src/web/quiz-sections.ts (new, pure) and tests/quiz-sections.test.ts
- src/web/QuizPanel.tsx: `lookAgain`, `landable`, `LookAgain`, and how `pick`, `move`, `included`,
  the verdicts map and the batch-reset effects interact with it
- the prop chain Reader.tsx → RememberBand → QuizSubBand → QuizPanel (ConversationModes.tsx)
- src/web/position.ts (`buildSections`, `sectionIndexContaining`) — is the section lookup right,
  including for a block before the first section, a supplement, and a stale evidence id?
- tests/quiz-panel.test.tsx § "where to look again"
- docs/project/quiz.md § Where to look again, and the reworded "never rendered" lines

Particular questions:
1. Can "Where to look again" ever show a section on no evidence, or keep one after a new batch?
2. Can "Back to its question" land on a question the filter hides, abort a mark wrongly, or destroy a
   draft in a way the list's `pick` would not?
3. Does anything print a verdict, count or score, or break the premise rule or the path order?
4. Are the tests capable of failing for the bugs they claim to guard?
5. Anything in docs that now says something false.

Then run: `npx vitest run tests/quiz-sections.test.ts tests/quiz-panel.test.tsx tests/remember-url-rules.test.tsx tests/client-imports.test.ts` and `npm run typecheck` (judge by exit code).

Write your findings, numbered with severity P0/P1/P2, each with file:line evidence, what you fixed
(if anything) and what you left for me to decide. Say plainly at the end which gates you ran and
their exit codes.
