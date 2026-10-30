You are reviewing a plan before it is built, read-only. Repo: Spideryarn (TypeScript, Postgres via Drizzle, React client).

Plan: docs/plans/261030c-quiz-keeps-right-or-wrong-and-spacing-adapts.md — read it in full.

Context to read:
- docs/user-feedback/questions/q-m9zkx3.md (the question Greg answered "B")
- docs/plans/261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md (what is on dev now)
- src/web/quiz-recall.ts, src/web/useQuiz.ts (KeptAnswer, keptFromServer, noteMark, the mark's done handling), src/web/QuizPanel.tsx (verdicts derived from kept), src/web/marginalia/MarginQuiz.tsx
- src/routes.ts `markOneAnswer`, src/store/pg-quiz-attempts.ts, src/store/contracts.ts `QuizAttemptStore`, src/types.ts `QuizKeptAnswer`, src/db/schema.ts `quizAttempts`
- src/quiz-verdict.ts, src/quiz-mark.ts (where the verdict comes from; when it is absent)
- src/web/PrivacyPage.tsx, docs/project/privacy.md § Quiz answers, src/store/export.ts, src/store/your-words.ts, src/store/pg-article-transfer.ts
- docs/project/quiz.md, docs/project/sql.md

Constraints from the brief: a declined or failed check must never be saved as wrong; an answer edited later is judged again; the privacy page and privacy.md must say right/wrong is now kept and why; the export carries it; an additive migration.

Look for: correctness holes in the spacing rule (edge cases, nulls, clock, ordering, concurrency between record and the history read), places that still claim the verdict is not stored or that rely on it not being stored, wire/back-compat problems (offline copies, old servers, old rows), privacy wording that is inaccurate, anything in the export/transfer/admin/delete paths that would miss or mishandle the new column, tests that could pass while the feature is broken, and whether a simpler design does the same job. Also say whether you agree that no separate judged_at column is needed.

Write numbered findings (F1, F2, ...), each with severity (high/medium/low), the file/line evidence, and a concrete recommendation. Do not edit any files. End with a one-line verdict.
