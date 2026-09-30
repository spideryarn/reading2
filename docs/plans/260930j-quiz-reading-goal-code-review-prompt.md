# Code review: quiz questions shaped by the reader's reading goal (260930j)

You are reviewing BUILT CODE in the repo at the current directory, commit b74507c9 (HEAD). You may
fix what you find inside this stage — edit files, and add or change tests — but: do not commit, do
not touch git state, do not edit .env*, infra/, systemd, or anything listed as a defence in
docs/project/security-map.md § Where the defences physically live. Do not make any paid model call
(no evals). Report anything wider than this stage for me to decide.

Read:
- The plan, including its § Progress and the measurement table:
  docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md
- Your own plan review: docs/plans/260930j-quiz-reading-goal-plan-review-sol.md
- The code diff: docs/plans/260930j-quiz-reading-goal-code-review.diff (src/quiz.ts, src/pipeline.ts,
  tests, evals/quiz-reading-goal.ts), and the doc changes in docs/project/quiz.md § Shaped by why
  you are reading and docs/project/reader-profile.md.
- The eval outputs under evals/results/quiz-reading-goal/ (six arms, and blind/ — questions.tsv,
  key.tsv mapping each number to its arm, labels.tsv from a blind Sonnet judge).

Check:
1. Correctness of the plumbing: ctx.profile → generateQuiz → renderPrompt; nothing about the reader
   enters the system blocks (cache prefix shared with ideas/sketch/timeline); no-profile prompt is
   byte-identical to before. Any caller of generateQuiz/renderPrompt left behind (evals/quiz.ts,
   evals/quiz-build-up.ts, evals/plain-words/artefacts.ts)?
2. The prompt text added to QUIZ_SYSTEM and readerSection: does it conflict with the existing rules
   (path, premise, "Cover the piece", what is not a question), leak the goal into questions, or let
   the About line change proportions? Is the wording plain (docs/project/prompting-guide.md)?
3. The tests: would each go red if the thing it guards broke? Is tests/quiz-job-carries-the-reading-
   goal.test.ts correctly registered (tests/store-migration-registry.ts) and hermetic (VERCEL=1 so
   nothing runs; cleans its jobs; no provider call)?
4. The docs: accurate against the code? Any claim that is not traced (e.g. "visitors never see a
   quiz", "a CLI run posts no profile", "Retry reuses the snapshot")?
5. **Check the conclusion, not just the code.** The predeclared bar ("more than half in part 7") was
   missed (47%, 42%); I then ran a blind judge and report 74% on-goal. Recompute both columns from
   the files. Is the blind judge's labelling reasonable on a sample you read yourself? Is my
   explanation of the missed proxy fair, or am I explaining away an inconvenient result? Say plainly
   whether the evidence supports "most of the questions are about the goal".

Write findings as a numbered list: severity (P0/P1/P2), evidence (file:line), what you changed if
you fixed it. End with a one-line verdict: ship / fix before ship.
