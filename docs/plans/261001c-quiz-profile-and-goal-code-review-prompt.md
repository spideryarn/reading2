Code review, write-capable, of the work in docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md (read it first, including "What the measurement found"). You reviewed its plan: docs/plans/261001c-quiz-profile-and-goal-plan-review-sol.md is your answer, and the plan's Progress says what was taken.

The diff you are reviewing (everything except the result JSON): docs/plans/261001c-quiz-profile-and-goal-code-review.diff, base c64700b6, two commits 4e65a05c and 94ab1df4.

Evidence to check, not just prose:
- The runs: evals/results/quiz-reading-goal/{old,new,r2}-*/entropy-24-00930-spya-pywwkq.json (each has a provenance block: git head, quizDirty, sha256 of src/quiz.ts).
- The blind sheets, keys and four judges' labels: evals/results/quiz-reading-goal/blind-261001c/{questions,key}.tsv + judge1/, judge2/; blind-261001c-r2/ + judge3/, judge4/. Each judge dir has score.txt and bars-*.txt.
- The bar checker: evals/quiz-reading-goal-261001c-bars.ts; re-run it (`npx tsx evals/quiz-reading-goal-261001c-bars.ts <judge dir> r2` or `new`) — free, no model calls.
- The judge rubric committed before any run: evals/quiz-reading-goal-judge.md.

Please:
1. Review the code: src/quiz.ts (QUIZ_SYSTEM back to pre-6Q bytes, QUIZ_READER_RULES sent as a system block only with a profile, readerSection, comments), src/profile.ts header, the tests (tests/quiz.test.ts, tests/quiz-step-registration.test.ts, tests/profile-prompts.test.ts, tests/quiz-reading-goal-eval.test.ts), evals/quiz-reading-goal.ts (provenance, blind, score), the docs (docs/project/quiz.md, docs/project/reader-profile.md). Look for real defects: anything that breaks the no-profile request staying byte-identical to pre-6Q, the cache layout, a test that cannot go red, a doc claim the code contradicts, prompt wording that conflicts with QUIZ_SYSTEM's own rules.
2. Check the CONCLUSION, not only the code. Recompute the bar results from the labels. Is the plan's "claim, at its right size" honest, or does it explain away an inconvenient result? Is shipping the round-2 wording right given that bars 2, 3, 5, 6 and 7 fail (5 narrowly), or should it not ship / ship differently? Is anything in the post-hoc section overclaiming? Was it legitimate to run a second round of wording (the plan allowed one) and re-judge old arms alongside it?
3. docs/project/quiz.md's section still needs the measured numbers and the final balance wording; check what is there against the plan and fix if wrong.

You may edit files inside this stage to fix what you find (code, tests, docs, the plan's results text). Do not run paid model calls, do not touch evals/results/ JSON, do not commit or push. Report: a verdict (ship / ship with changes / do not ship), numbered findings F1… with file:line, and a list of every file you changed and why.
