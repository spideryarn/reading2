# Code review prompt: quiz questions that build up (260930c)

You are reviewing, and fixing, the code built from a plan you reviewed twice. Worktree:
this directory. The change is commit 443dbac9; the base is its first parent. Read the diff with
`git diff 443dbac9^1 443dbac9 -- src tests evals/quiz-build-up.ts evals/quiz.ts`.

Read first: docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md (especially § The
shape, § The walk, § Wire compatibility, § Review log), then docs/project/quiz.md § A path and
§ It adapts: the premise. Your two plan reviews are the -review-sol.md and -review-sol-2.md files
beside the plan.

Code not written by me: the client walk (src/web/QuizPanel.tsx, src/web/quiz-ladder.ts,
src/web/styles/quiz.css) and most test rewrites were done by an Opus subagent. I wrote src/quiz.ts,
src/types.ts, src/pipeline.ts, src/routes.ts, evals/quiz-build-up.ts.

What I want checked hardest:
1. src/web/QuizPanel.tsx: the index walk, `arrivedByNext`, the verdict map (set on done, cleared on
   batch change), Next waiting while a mark is arriving, and that no premise text reaches the
   all-questions list or any grading/difficulty word reaches the page.
2. src/quiz.ts `toQuestions`: `gaps` counting, `readPremise`, the cap.
3. `withOldClientBands` and its use in src/routes.ts GET /api/quiz/:slug; the mark route sending the
   stem only.
4. Anything that reports success while doing nothing (docs/reusable/silent-success.md).

Rules for fixing: fix what is inside this change, narrowly, red-first (write or adjust a test that
fails, then fix). Do NOT edit the QUIZ_SYSTEM prompt text (it is measured; report prompt issues
instead). Report, do not fix, anything wider. You can run pure test files yourself, e.g.
`npx vitest run tests/quiz.test.ts tests/quiz-ladder.test.ts tests/quiz-panel.test.tsx`;
Postgres-backed suites need a database you may not have — say so rather than skipping silently.
Do not commit.

My own gate output on 443dbac9: typecheck exit 0; 16 files / 339 tests passed across
tests/quiz*.test.*, messages, client-imports, plain-words-coverage, doc-links,
every-ai-code-is-registered, stage-stamp-agreement, pipeline-artifact-store,
mode-surface-changes-no-markup.

My suspicions, last: `batchHasGaps` counting a drop before the first kept question makes every
premise show for the whole batch; dropping `quiz-spread` from CODE_KINDS changes how old stored job
errors are classified; the `.quiz-premise + .quiz-question` CSS.

Output: findings with IDs (C1, C2 …), severity P0–P3, file:line, what you changed (if anything) and
the test that proves it; then the list of wider issues you did not fix. End with a one-line verdict.
