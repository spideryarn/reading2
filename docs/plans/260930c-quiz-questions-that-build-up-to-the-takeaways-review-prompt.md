# Review prompt: the plan for quiz questions that build up (260930c)

You are reviewing a PLAN, read-only, before anything is built. Revision: commit d9c5cec7 in this
worktree.

Read, in this order:

1. docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md — the plan under review.
2. docs/project/quiz.md — the feature as it stands, including the adaptive ladder (§ It adapts).
3. docs/user-feedback/260905_1800-quiz-questions-too-hard.md § What Greg decided — the prior
   decision this plan must not contradict (no difficulty control).
4. src/quiz.ts (QUIZ_SYSTEM, toQuestions, orderQuestions, buildQuiz), src/web/quiz-ladder.ts,
   src/web/QuizPanel.tsx, src/quiz-mark.ts (how the verdict rides the done frame), src/quiz-verdict.ts.
5. docs/project/prompting-guide.md § Measuring a prompt change, and evals/quiz-build-up.ts.

Greg's request, verbatim, is quoted at the top of the plan. Only his words express intent.

Questions I want answered:

A. Is retiring the adaptive ladder the right call, or is there a simpler design that keeps
   adaptivity AND lets questions build on one another? Argue the strongest case against the plan.
B. The new prompt rule "a later question may state, as its premise, what an earlier question
   established". Does it create a giveaway problem (a later question revealing an earlier answer,
   or its own), and is the plan's handling of the Show-all list acceptable?
C. Anything in the retirement list that would break silently: stored quizzes with band/value in
   their JSON, the done-frame contract, cost categories / spend rows naming the verdict call, tests
   that assert the words never reach the page, the eval's marking cases.
D. Is the measurement adequate for the claim it makes, and is anything in evals/quiz-build-up.ts
   wrong (blinding, coin, pairing)?
E. Twenty questions and ANSWER_TOKENS 16000 with adaptive thinking — sensible?

My own suspicions, last: that dropping the band-sort makes a dropped mid-path question worse than
the plan admits; and that the model will write "takeaway" questions at the end that are really hard
questions with a premise bolted on.

Severity scale: P0 (would ship broken or contradict Greg), P1 (real defect, fix before building),
P2 (worth doing), P3 (nit). Give each finding an ID (F1, F2 …), a severity, the file/section, and
the fix you propose. Write your findings to the output file. End with a one-line verdict: build as
written / build with the P0-P1 fixes / do not build.
