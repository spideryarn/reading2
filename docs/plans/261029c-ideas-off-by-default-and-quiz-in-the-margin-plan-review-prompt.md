Review this plan before it is built: docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md
(read-only review; do not edit files). Repo rules: CLAUDE.md. Relevant docs: docs/project/marginalia.md,
docs/project/quiz.md (§ In the prose, § The artefact), docs/project/skim.md (§ Stage 6 / It waits for the Ideas),
docs/project/ideas.md. Relevant code: src/auto-mode-steps.ts, src/web/auto-modes.ts, tests/auto-modes.test.tsx,
src/web/useRelations.ts, src/web/useAutoRun.ts (useAutoRun, useAutoRunOnArrival, beginAutoAttempt in jobEngine),
src/web/useQuiz.ts (useQuizRead, useQuiz), src/web/marginalia/MarginaliaColumn.tsx (OwnerMarginFeed, MarginNotes),
src/web/marginalia/notes.ts (marginaliaNotes), src/web/quiz-anchors.ts, src/web/QuizInProse.tsx,
src/web/reader/Reader.tsx (quizAfter ~line 2399, marginRoom ~757, marginColumn ~4542), src/skim.ts, src/web/useSkim.ts,
src/store/pg-revisions.ts (publishRevisionIn, where import jobs are queued).

Look for: anything else that would still buy Ideas on import; whether filtering Skim's import job's reads is right
(the job also exists to retry Quotes); whether the server's skim step accepts running without ideas present;
whether the margin's Quiz auto-run sharing the (slug,"quiz") auto-attempt with the band's press-armed run causes a
lost or double run; whether suppressing prose quiz lines on `marginRoom` is correct (margin open but band covering,
narrow window, visitor); memo/render costs in TableView; anything the plan misses. Findings ranked, each with file:line
and a concrete failure scenario. Say plainly if you find nothing serious.
