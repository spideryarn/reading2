# Plan review: quiz questions shaped by the reader's reading goal (260930j)

You are reviewing a PLAN, read-only, in the repo at the current directory. Read:

- docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md (the plan, with Greg's words)
- docs/project/quiz.md, src/quiz.ts (QUIZ_SYSTEM, renderPrompt, generateQuiz), src/pipeline.ts § the `quiz` step
- src/profile.ts (renderProfile, PROFILE_RULES, profileSection, hashProfile)
- src/routes.ts § POST /api/jobs (search "useProfile === false") and resolveProfile
- src/web/useQuiz.ts (ensure / write)
- src/store/pg.ts § ProfileCarrying / personalisedSteps
- docs/project/prompting-guide.md and evals/quiz.ts

Check, and say what is wrong or missing:

1. Is it TRUE that a quiz job posted by useQuiz (both ensure and write) already carries ctx.profile including this article's purpose? Trace it. Any path (auto-run, rerun section on Metadata, reset route, CLI) where the quiz runs WITHOUT the profile, or with a stale one?
2. The deviation: the job carries the whole rendered profile (About you + purpose), not the purpose alone. Is confining "About the reader" to pitch in the prompt a reasonable v1, or should we do purpose-only? Is there a cheaper purpose-only route than a second Job field that I missed?
3. Caching: is the plan's split right (constant rules in QUIZ_SYSTEM, the profile in renderPrompt's user message after the article breakpoint)? Does anything else share this prefix in a way this breaks?
4. Dropping profileHash from the artefact in v1 — right call given ProfileCarrying / the make-public dialog? Any risk that the quiz, now written from the purpose, reaches a visitor (public DTO, export, sharing)?
5. No PROMPT_VERSION bump — agree?
6. The measurement: is "more than half of questions' evidence in the target part, with a purpose; vs the share without" a sound, cheap bar? Better design?
7. Anything in the prompt substance (plan § What this changes, item 4) that would conflict with QUIZ_SYSTEM's existing rules (path, premise, "Cover the piece", "WHAT IS NOT A QUESTION HERE") or make the model address the reader.

Write findings as a numbered list, each with severity (P0/P1/P2), the evidence (file:line), and a concrete fix. End with a one-line verdict: build / revise before build. Do not edit any files.
