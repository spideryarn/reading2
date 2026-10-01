# P09 key: quiz questions avoid the article's worked examples, shown to be better

## 1. Docs it must read
- MUST `docs/project/prompting-guide.md` § "Measuring a prompt change" — the 8-step method: production's own function, old prompt run twice as control, arms separated in time not code, paired + tested coin + key in its own file, blind judge in a fresh subagent, compare to control, screens only as screens, read the outputs.
- MUST `docs/project/quiz.md` § "A path, since 2026-09-30" and § "Shaped by who you are and why you are reading" — the prompt's current shape (path, premises, `QUIZ_READER_RULES` only with a profile).
- MUST `src/quiz.ts` comment above `QUIZ_SYSTEM` — house style (shouted headings, prohibition + reason) and "What a `PROMPT_VERSION` bump is for".
- USEFUL `docs/project/prompting-guide.md` § "Where it lives, and how a prompt uses it" — the shared `plainWords()` section, not to be edited for a quiz-only rule.
- USEFUL `docs/plans/261001c-…reading-goal.md` § "How we will know it worked" / "What the measurement found" and `docs/plans/261001h-…contrasting-terms.md` § "Measuring it" / "Why not keep trying wordings" — worked examples of bars declared first, judges, and an honest not-shipped result.
- USEFUL `docs/reusable/codex-cli-as-subagent.md` § house workflow; `docs/reusable/write-planning-doc.md`.

## 2. Existing code it must reuse
- `src/quiz.ts` § `QUIZ_SYSTEM`, `QUIZ_READER_RULES`, `generateQuiz`, `renderPrompt`, `PROMPT_VERSION` — edit the one prompt; the eval calls `generateQuiz`, never a copy of the prompt.
- `evals/quiz-reading-goal.ts` § `generate` (records git commit, dirty flag, sha of `src/quiz.ts` — `sourceProvenance`), `blindOrder` (sha256 of seed+item, not a float LCG), `blind`, `score` — the newest harness; extend with a new label rather than writing a third harness.
- `evals/quiz-reading-goal-judge.md` — pattern for a judge-instructions file committed before any run (add a label such as EXAMPLE: does the question hinge on a worked example).
- `evals/quiz-build-up.ts` § `generate --arm`, `report`, `pairs`; `evals/plain-words/run.ts` § `blindCoin` — whole-quiz pairs and the tested coin.
- `evals/quiz-reading-goal-261001c-bars.ts` — the shape of a per-judge bars checker.
- Trap: a new `evals/quiz-examples.ts` that pastes the prompt, shuffles with `Math.random`, or puts key and sheet in one file.

## 3. Code files it would edit
- `src/quiz.ts` (`QUIZ_SYSTEM`, plus the comment above it)
- `tests/quiz.test.ts` (pin the new rule by name, red first against the old prompt)
- `evals/quiz-reading-goal.ts` or `evals/quiz-build-up.ts` (+ a judge `.md`); results under `evals/results/…/<arm>/`
- `docs/project/quiz.md` (one line); a plan `docs/plans/<npx tsx scripts/plan-name.ts>-….md`

## 4. Project rules that apply
- Read prompting-guide.md before changing a prompt — `CLAUDE.md` § Writing code.
- Failing test first — `CLAUDE.md` § Before you call it finished; `docs/project/testing.md`.
- Plan to GPT Sol (read-only) before building, code to Sol (write-capable) after; check exit code AND fresh answer file — `docs/reusable/codex-cli-as-subagent.md`.
- Keep paid runs to a few dollars — prompting-guide.md § Measuring; costs go through the gateway automatically (`docs/project/cost-tracking.md`).
- Decide `PROMPT_VERSION`: a bump marks every stored quiz outdated; it goes up only when what a question *is* changes — `src/quiz.ts` comment; `quiz.md` § "The artefact".
- Gates: `npm test`, `npm run typecheck` (judge by exit code) — `docs/project/code-quality-overview.md`.

## 5. Traps
- No-profile and profiled requests use different system blocks; measure both, and keep no-profile byte-identical except for the intended rule (261001c § What changes).
- Declare integer bars and the judge file before any run; fresh same-day old-prompt controls, not stored runs (261001c, Sol F6/F7).
- A broken shuffle put one arm on one side 94/95: check the key's balance before judging (prompting-guide.md step 4; 261001c `blind` prints halves).
- An example in the rule should come from another field, so the eval is not the prompt reciting its answer (261001h § What was tried).
- A four-word wording change reversed the effect; one round is noise — run the control, report a fail honestly, do not ship what you cannot show helps (261001h § Why not keep trying wordings).
- Screens over- and under-flag; read every flagged output by hand (261001h § Measuring it).
- Judges can sit on the floor of a label (261001c bar 2): pick a label they actually give.
