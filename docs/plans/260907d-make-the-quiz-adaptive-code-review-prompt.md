# Review the built adaptive quiz

You reviewed the plan for this a couple of hours ago and said *"I would not build the plan as
written"*, with seven findings. **I took all seven.** This is the code that came out, and this review
matters more than that one — a plan-stage review cannot find a `PATCH` that writes one field and then
rejects the request.

## What changed since your plan review, so you can check I actually did it

1. **Option A is gone.** The verdict is your fifth option: a separate classifier
   (`src/quiz-verdict.ts`) that reads `{question, reader's answer, the finished mark}` and nothing
   else. `QUIZ_MARK_SYSTEM` is untouched — check that it is.
2. **The verdict rides `done` only**, never a delta, never its own frame.
3. **The invariant is amended, not reinterpreted** — your wording, in `src/quiz-ladder.ts`,
   `docs/project/quiz.md` and `QuestionList`. The false "subsequence" tripwire is replaced by a
   per-band one.
4. **`partly` is gone** — two values and an absence.
5. **No rung state**; the target derives from the band of the question being answered.
6. **A total nine-cell table**; "then anything" deleted.
7. **Navigation specified first**, with a unique `seen` list. `A → B → C → Previous → pick D` has a
   test.
8. **"The first question is easy" was false** below `SPREAD_FROM`; corrected to "the front of the
   server's array".
9. **The simulation is relabelled** a worked trace, and the classifier got the real measurement.

## Read these

- `docs/plans/260907d-make-the-quiz-adaptive.md` — the revised plan, including both measurements
  with their results.
- The scoped diff: `/tmp/claude-1000/-home-greg-code-spideryarn2/23ea9a8c-bfb3-4942-ac50-0b4a63d1c83c/scratchpad/aq-code.diff`
- New: `src/quiz-ladder.ts`, `src/quiz-verdict.ts`, `tests/quiz-ladder.test.ts`,
  `tests/quiz-verdict.test.ts`.
- Changed: `src/quiz-mark.ts`, `src/routes.ts` (§ the quiz mark route's `done`), `src/web/useQuiz.ts`,
  `src/web/QuizPanel.tsx`, `src/models.ts`, `src/ai-call.ts`, `src/cost-categories.ts`,
  `evals/quiz.ts`, `tests/quiz-panel.test.tsx`, `docs/project/quiz.md`.

## What I want you to attack hardest

1. **`src/web/QuizPanel.tsx` — the `seen`/`cursor` state machine.** This is where I am least
   confident. Walk the transitions yourself: Next at the tail vs inside history; Previous; picking a
   seen and an unseen question from *Show all*; a new `batchId`; an attempt that is `marking`,
   `failed`, or superseded. Can a question be shown twice? Can `cursor + 1` exceed
   `questions.length`? Can a verdict be applied twice? Is there a state where Next is enabled and
   does nothing, or disabled while questions remain unseen? What happens if `seen[cursor]` names a
   question that is not in `questions` — is that reachable?
2. **The `batchId` reset effect.** It reads `questions` but lists only `quiz?.batchId` as a
   dependency (a pre-existing biome-ignore that I kept). Is there an ordering where the quiz loads
   and `seen` is left empty, so the panel renders nothing while questions exist?
3. **`src/quiz-verdict.ts`.** It must never throw and never break a mark. Is `AbortSignal.any`
   handled right? Does a reader navigating away leak anything? Is `parseVerdict` too strict, or too
   loose? Is the prompt likely to make `poisonedReference` come back `wrong` — the case that would
   punish a reader for being right?
4. **`src/quiz-mark.ts`** — the `await classifyVerdict(...)` sits between the log line and the `done`
   yield. Does that delay or endanger anything it should not? What happens to it on an abandoned
   stream? Does the spread `...(verdict ? { verdict } : {})` do the right thing under
   `exactOptionalPropertyTypes`?
5. **The new `quiz-verdict` job registration** across `models.ts`, `ai-call.ts` and
   `cost-categories.ts`. Did I miss a place a job has to be declared? Is quick tier / no provider
   `order` right?
6. **The measurements.** The trace shows adaptive is **identical to the fixed order for a struggling
   reader** — I have reported that as a limitation rather than buried it. Is my reading right? And is
   6-of-7 on the classifier, stable across two runs, enough to ship on, given the one miss is
   `illPosed` in the benign direction?
7. **Anything in the docs that is now false.** `docs/project/quiz.md` is the one that must not lie.

## What I do not want

Don't redesign the generation prompt. Don't propose storing attempts. Don't propose showing the
reader their level. Don't suggest a branch strategy.

## Output

Findings ordered by severity, each with what is wrong, why it matters, and what to do. Then say
explicitly: **ship it**, **ship it with these fixes**, or **do not ship**. I will check each finding
myself and some will be wrong.
