Review the code built from plan docs/plans/261029i-quiz-answered-in-the-margin-with-voice-and-a-quiet-green.md,
in this worktree. Your earlier read-only review of the plan is docs/plans/261029i-plan-review-sol.md; the plan's
§ The plan review says what was done with each finding (F1 deliberately not done, F3 `flushSync` kept, with reasons).

The change is the diff of this branch against origin/dev: `git diff origin/dev...HEAD` (and any uncommitted
changes: `git diff HEAD`). Files of interest:

- src/web/useQuiz.ts — `useQuizMark` lifted out of `useQuiz`; `claimMark` in `useQuizRead`.
- src/web/marginalia/MarginQuiz.tsx — new: the margin's answerable Quiz lines, one-press microphone, green.
- src/web/marginalia/MarginaliaColumn.tsx — the old `QuizNote` removed, the new one imported.
- src/web/reader/Reader.tsx — `MarginQuizContext` provided (search `marginQuiz`).
- src/web/QuizPanel.tsx — `Mark` exported as `QuizMarkText`; `quiz-answered` on the band's question.
- src/web/styles/marginalia.css (§ the quiz), src/web/styles/quiz.css (`.quiz-answered`), src/web/styles/mode-band.css.
- src/web/marginalia/tips.ts, src/web/help/pages/modes/{learn,marginalia}.md — reader-facing words.
- src/quiz.ts, src/messages-stream.ts — eval-only `experiment` (model, instructions, maxQuestions) and `model` override.
- evals/quiz-models.ts, evals/quiz-models-lib.ts, evals/quiz-cases.ts (moved from evals/quiz.ts unchanged), evals/quiz.ts.
- tests/marginalia-quiz-answer.test.tsx, tests/quiz-models-eval.test.ts, tests/helpers/quiz-read-stub.ts and three stubs.
- docs: quiz.md, marginalia.md, evals/README.md, the plan, docs/user-feedback/questions/q-cj0fv8.md.

The house rule since 2026-09-09: **fix what you find inside this stage** (edit the files directly), and report anything
wider for me to decide. Write your findings first, to the answer file, before or alongside fixing: for each, severity,
file:line, the concrete failure (inputs/state → wrong result), and what you changed (or why you did not). Then run
`npm run typecheck` and the touched suites (`npx vitest run tests/marginalia-quiz-answer.test.tsx tests/marginalia-quiz.test.tsx
tests/quiz-panel.test.tsx tests/quiz-kept-answers.test.tsx tests/quiz-mark-stream.test.tsx tests/quiz-models-eval.test.ts tests/quiz.test.ts`)
and say what they printed. Do not commit, push, deploy, or touch any database. Do not spend money: no model calls (the
eval's --dry-run is free).

Look hardest at:
1. `useQuizMark` / `claimMark`: is the release always called (every early return, abort, throw, unmount)? Could a claim leak
   so a question becomes unmarkable for the rest of the visit? Is the band's behaviour exactly as before?
2. MarginQuiz `Answerable`: the open/close/switch lifecycle and aborts; the kept-answer restore in `show` and the late-read
   effect (can it clobber a draft or a dictation in progress?); `submit` referenced before `dictate` is declared; the
   `flushSync` + `toggle` path and the dictation keeper binding (useDictation.ts § `elsewhere`); keyed-by-batch remount.
3. Reader's `marginQuiz` memo: does it keep `memo(TableView)` from re-rendering (the context is outside it), and is it
   owner-only? Is `stale: false` right given `drawnQuiz` already excludes stale?
4. Accessibility and touch: sibling buttons, aria-expanded/controls, 40px coarse targets, the tick's announced state.
5. CSS at a 200px margin; the green's contrast in both themes (the words stay ink on a 13% wash).
6. The eval: the `experiment` plumbing can never reach production; `SMALLER_REPLACEMENTS` really find their passages; the
   cap is honoured in prompt, request and validator; failures are counted; blind pairs and key are right; costs per call.
7. Docs and reader-facing copy: anything stale or contradictory left (e.g. quiz.md still saying a margin press opens Learn,
   or the verdict rule).
