Review the plan docs/plans/261002f-quiz-regenerate-for-my-profile.md (read-only; do not edit files).

Context: plan 261002b (docs/plans/261002b-written-for-your-profile-panel-edit-in-place-and-regenerate.md, commits 805b40654 and 559e5c1b4) gave profile-aware modes a "written for your profile" badge (src/web/WrittenForYou.tsx) opening an editable panel with Regenerate (src/web/ProfilePanel.tsx). Quiz was deferred. Greg now wants Quiz to have it, and accepts losing answers.

Check the plan against the code: src/quiz.ts (header § The profile, generateQuiz, buildQuiz), src/pipeline.ts (quiz step stamp), src/routes.ts (GET /api/quiz, withProfileChanged), src/types.ts (Quiz, QuizResponse, QuizFound), src/store/pg.ts (ProfileCarrying, personalisedSteps, loadQuiz, shareableArtefacts), src/messages.ts (OWNED_ARTEFACT), tests/messages.test.ts, src/web/useQuiz.ts, src/web/QuizPanel.tsx, src/web/ProfilePanel.tsx.

Questions: Is anything wrong or missing? Will excluding "quiz" from ProfileCarrying break anything else that relies on it? Does the batch reset genuinely clear answers on a forced rewrite? Any loop (Regenerate offered again after regenerating) or double-spend risk? Anything in the public/visitor path that a new Quiz field could leak (src/public/dto.ts etc.)? Is there a simpler design? Give findings ranked P0/P1/P2 with file:line evidence, and a one-line verdict at the end.
