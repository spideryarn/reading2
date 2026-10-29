Review a plan before it is built. Read-only: do not edit anything.

The plan: docs/plans/261029i-quiz-answered-in-the-margin-with-voice-and-a-quiet-green.md

Context to read (the plan cites them): docs/project/quiz.md (especially § It adapts, § Whether the reader
got it right is asked somewhere else, § On screen, § Answers are kept, § In the prose),
docs/project/marginalia.md § Quiz's questions, docs/plans/261029c-ideas-off-by-default-and-quiz-in-the-margin.md,
docs/user-feedback/questions/q-ejp09q.md, docs/project/privacy.md § Quiz answers.

Code: src/web/useQuiz.ts (useQuizRead, useQuizOnShow, useQuiz and its `mark`), src/web/QuizPanel.tsx (the answer
box, `submit`, `cannotAnswer`, `Mark`, `Mic`, the verdict effect), src/web/marginalia/MarginaliaColumn.tsx
(`QuizNote`, `MarginNotes`, the `MarginCiteActions` context, `useMarginLayout`), src/web/reader/Reader.tsx
(`marginNotes`, `openQuizAt`, `marginRoom`), src/web/useDictationField.ts and src/web/useDictation.ts (`toggle`,
how a press starts the microphone), src/quiz.ts (`generateQuiz`, the prompt's HOW MANY section), src/quiz-mark.ts
(`markAnswer`'s `model`), src/messages-stream.ts (`streamMessage`, `messagesWireBody`), src/models.ts
(`resolveModel`, `MODEL_ENV_VAR`), evals/quiz.ts.

Greg's words that this answers are quoted at the top of the plan. The product calls already made: answer in the
margin rather than jumping to Learn; mic easy to reach; a subtle green, not gamification; Haiku/Sonnet evals,
which cannot run until the OpenRouter key resets on 2026-11-01.

Please look hardest at:
1. Stage 1: is lifting `mark`/`attempt`/`showKept` into `useQuizMark` safe for the band's existing invariants
   (one live request, abort on unmount and on move, restored flag, verdict effect, noteMark/refresh)? Anything
   the band relies on that would break if the margin and the band each hold their own hook at the same time?
2. Stage 2: the one-press "open and start listening" via flushSync + toggle in the same handler. Will
   `useDictationField.toggle` work with a box that mounted in that same handler (box ref, caret, closures from the
   previous render)? Is there a simpler way to honour "very easy to access"? What about Safari?
3. Stage 3: the reversal of "the verdict is never rendered" for the `right` case only. Is it consistent with the
   rest of quiz.md (superseded marks, restored marks, Where to look again, the panel test that bans words)? Is
   green-on-right vs green-on-answered the right call given Greg's words?
4. Stage 4: is the harness design sound (arms, repeats, blind read, the asserted prompt replacement, the
   `experiment` override threaded through streamMessage)? Does an override break anything that keys on the model
   (fingerprints, the ledger, `generationKey`)? Is the decision rule stated before the run adequate?
5. Anything simpler that gives Greg the same thing. Anything missing that will bite: layout in a narrow margin,
   touch, keyboard (keynav), a stale quiz, a visitor, StrictMode double effects, memo(TableView) re-renders.

Give numbered findings, each with severity (High/Medium/Low), the concrete problem with file:line references, and
the fix you recommend. Say plainly if a finding is a judgement call rather than a defect.
