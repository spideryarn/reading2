# P09 before: quiz prompt should avoid the article's worked examples

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (context) - pointed to the reading-view overview map; the quiz.md link was only found by scanning the long list. Said prompts need `prompting-guide.md`.
- `docs/project/quiz.md` - very helpful: names `src/quiz.ts`, `evals/quiz.ts` ("read this before editing either prompt"), the version rules, the 261001c goal-aware section.
- `docs/project/prompting-guide.md` - helpful: the 8-step blind A/B method, `evals/plain-words/run.ts` coin, control arm.
- `evals/README.md` (head) - listed evals; did not mention `quiz-build-up.ts`, which I found only via `ls evals` and the quiz.md/header references.
- `evals/quiz.ts` header and `evals/quiz-build-up.ts` header - the build-up header gives the exact before/after/pairs/report commands.
- Did not open `docs/project/mode.md`, `cost-tracking.md` (only grepped) - not needed for a prompt-only edit.

## 2. Code files you would edit
- `src/quiz.ts` - `QUIZ_SYSTEM`: add a section (near "KEEP TO WHAT MATTERS" / "WHAT IS NOT A QUESTION HERE") telling the model not to build questions on the article's worked examples, illustrations, anecdotes, analogies or case studies; ask about the principle they illustrate, in general terms. Update the long comment above it.
- `tests/quiz.test.ts` - pin the new rule by name, as it does for other rules.
- `evals/quiz-build-up.ts` (or a new small sibling eval) - add a screen/pairs question: "does this question depend on a worked example". No existing screen measures it.
- `docs/project/quiz.md` - a short note under the path/prompt part; plan doc under `docs/plans/` (name via `npx tsx scripts/plan-name.ts`).

## 3. Existing helpers/components/functions to reuse
- `src/quiz.ts` § `generateQuiz`, `renderPrompt`, `QUIZ_SYSTEM`, `PROMPT_VERSION` - production function the eval calls.
- `evals/quiz-build-up.ts` § `generate --arm`, `report`, `pairs` - arm runner and blind pairs with key.
- `evals/plain-words/run.ts` § `blindCoin` - the tested shuffle.
- `src/plain-words.ts` § `plainWords("ask","explain")` already in the prompt; unchanged.
- A new helper is needed for the metric itself: a cheap screen (or blind judge prompt, in the style of `evals/quiz-reading-goal-judge.md`) that flags questions resting on an example. I found none existing.

## 4. Rules/policies I would follow
- Read `evals/quiz.ts` before editing the prompt (`quiz.md`).
- Measure, do not eyeball: production function, control arm (old prompt run twice), arms separated in time by commit, blind shuffled pairs, key checked for balance, fresh-subagent judge asking both "which depends less on a worked example" and "did either lose a takeaway or fidelity", compare with the control spread, read outputs anyway (`prompting-guide.md`).
- `PROMPT_VERSION` bump only if what a question is changes; a wording fix does not bump it (comment in `src/quiz.ts`). I would not bump `quiz/5` and would say so.
- Plain-words rule stays (`prompting-guide.md`); the prompt describes what a good quiz is, none of our machinery (`src/quiz.ts` comment).
- Quiz questions must stay whole, small, anchored, one thing asked (`quiz.md`); questions must not leave out centrality. Keep the byte-for-byte no-profile promise: `tests/profile-prompts.test.ts` pins these bytes, so a prompt edit means updating that test deliberately.
- Plan doc before building and GPT Sol review of plan then code (`CLAUDE.md`); worktree, commit by name, push to `dev`.
- Test-first: write the pin test, see it red. Run `npm test`, `npm run typecheck`. Paid evals cost a few dollars per run; AI cost is tracked through the existing gateway so no new declaration (`cost-tracking.md`, only skimmed).

## 5. Where I got lost
- No doc says what counts as a "worked example" in this app, nor whether quiz already forbids it; I had to read the full prompt. It partly does (premise rules, "context is not a premise") but nothing about examples.
- `evals/README.md` does not list the quiz evals, so the build-up eval's existence is learned from `ls`.
- `quiz.md` is long and the prompt-edit guidance is scattered (quiz.md, src/quiz.ts comment, prompting-guide.md). The 261001c measurement section hints the prior judges and bars exist in `evals/quiz-reading-goal*` but I could not open the 2610 plan to see how they were built.
- Unsure which articles the eval should run on: no doc lists a suggested corpus for quiz (slugs come from the local DB).

## 6. Confidence
7/10
