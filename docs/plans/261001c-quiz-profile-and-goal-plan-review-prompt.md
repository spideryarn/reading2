Review this plan before it is built: docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md

Context: it reverses one deliberate choice in docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md (read it), on Greg's answer quoted at the top. The code is src/quiz.ts (QUIZ_SYSTEM, the section "IF THE READER HAS SAID WHY THEY ARE READING", renderPrompt, readerSection), src/profile.ts (renderProfile, PROFILE_RULES), tests/quiz.test.ts, tests/profile-prompts.test.ts, evals/quiz-reading-goal.ts and the stored results in evals/results/quiz-reading-goal/ (including blind/). docs/project/prompting-guide.md is how a prompt change is measured here. docs/project/quiz.md is the mode's doc.

Please check, and be concrete (file, line, what goes wrong):
1. Is the prompt design right: both halves of the profile moving which parts, kind of question and pitch; reason leads, About chooses within it. Any conflict with existing QUIZ_SYSTEM rules (e.g. "Anything answerable without having read the piece", KEEP TO WHAT MATTERS, Cover the piece, the path rules)?
2. The balance rule against a strong goal skipping the piece's central points: is "three or four of twenty on what the piece as a whole is for" the right shape? Better alternatives?
3. The eval: arms, controls, blind judge labels (GOAL, FIT, ASSUMED, CENTRAL), the predeclared central points C1-C3, and the bars. Are any bars unfalsifiable, circular, or too easy to pass? Is FIT too subjective to be a measure, and what would be better? Is the comparison with old-prompt arms sound given they ran days apart?
4. Anything that keeps the no-profile case from staying as it is today.
5. Anything the plan forgets to update (docs, comments, tests).
Give a verdict: build as is / revise before build / rethink. Number your findings F1, F2...
