Code review of the work built from docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md
(read the plan, and your own plan review beside it: docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin-plan-review-sol.md).
The diff is the last commit on this worktree's branch: `git show HEAD` (also `git diff HEAD~1 --stat`).
Repo rules: CLAUDE.md / AGENTS.md.

You may FIX what you find, inside this change's scope, by editing files in this worktree (do not commit,
do not run git commands that change history or the index, do not touch production or .env files).
Model calls fail on this box until 1 November, so do not run anything that calls a model.
After any fix run: `npm run typecheck` and the touched tests, e.g.
`npx vitest run tests/marginalia-quiz.test.tsx tests/auto-modes.test.tsx tests/marginalia-relations-on-open.test.tsx tests/artefact-read-hooks.test.tsx tests/marginalia-live-refresh.test.tsx tests/gift-prep.test.ts tests/publication-queues-the-main-modes.test.ts`.

Look especially for: correctness of the Ideas removal (anything else still buying Ideas on import or for a gift,
anything that assumed Ideas exist after import); the margin Quiz auto-run (useQuizOnShow in src/web/useQuiz.ts,
called from OwnerMarginFeed) — lost or double runs with the band's own press-armed run, cost leaks (runs when
the notes are not visible, for a visitor, while viewing-as); the prose/margin suppression in src/web/reader/Reader.tsx
(quizAfter on marginRoom) — any state where a question is drawn twice or nowhere; memo identity regressions that
re-render TableView on scroll; the new QuizNote in MarginaliaColumn.tsx (accessibility, the delegated card via
data-marg-tip="quiz", fonts per voice — docs/project/fonts.md); and whether the docs edited (marginalia.md, quiz.md,
skim.md, ideas.md) are now true. Also check the feedback notes and the question file (docs/user-feedback/…261029_*,
docs/user-feedback/questions/q-ejp09q.md) for factual errors against the plan's measurements.

Write your findings ranked, each with file:line, a concrete failure scenario, and whether you fixed it.
Say plainly if you find nothing serious.
