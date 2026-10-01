# P09 after2 — quiz prompt avoids the article's worked examples

## 1. Docs opened, in order
1. `AGENTS.md` / CLAUDE.md (in context) — pointed to reading-view-overview, prompting-guide.
2. `docs/project/quiz.md` — very helpful: names `src/quiz.ts`, `evals/quiz.ts` ("read before editing either prompt"), the path design, version policy.
3. `docs/project/prompting-guide.md` — very helpful: plain-words rule, and § Measuring a prompt change (control arm, blind judge, shuffled key).
4. Skimmed headers of `evals/quiz-build-up.ts` and `evals/quiz-reading-goal.ts` — the ready-made before/after harnesses.
(grep for "worked example" across docs found nothing about quizzes; no doc says how the quiz treats an article's own worked examples.)

## 2. Code files you would edit
- `src/quiz.ts` — `QUIZ_SYSTEM`: add a "WORKED EXAMPLES" rule (see below); decide on `PROMPT_VERSION` ("quiz/5" -> "quiz/6" because what a question is changes, per the comment above `QUIZ_SYSTEM`; this marks stored quizzes outdated, silently).
- `tests/quiz.test.ts` — pin the new rule by name (house habit: rules fixed by an observed failure are pinned); first a red test.
- `evals/` — a new small eval script modelled on `evals/quiz-build-up.ts` (or reuse it with `--arm`) to measure the effect; results under `evals/results/`.
- Possibly `docs/project/quiz.md` — one paragraph recording the rule and the result.

## 3. Existing helpers/components/functions to reuse
- `src/quiz.ts` § `generateQuiz`, `QUIZ_SYSTEM`, `PROMPT_VERSION` (production function, so the eval runs the real prompt).
- `evals/quiz-build-up.ts` § `generate`/`report`/`pairs` subcommands (arm files, prompt hash, blind pairs).
- `evals/plain-words/run.ts` § `blindCoin` (tested shuffle; count the key balance).
- `evals/quiz-reading-goal.ts` § `blind`/`score` (a judge sheet plus separate key, labels.tsv).
- New helper needed: a cheap "does this question rest on a worked example" screen. I found none; I would have a judge (fresh subagent) label each question, with an optional free heuristic (question text overlapping the worked-example blocks' distinctive terms) used only as a screen.

## 4. Rules/policies to follow
- Read `evals/quiz.ts` header before editing the prompt (`quiz.md`).
- Prompt-writing: shouted section headings, prohibition with reason attached, a BAD/GOOD pair (house style in `QUIZ_SYSTEM`); describe what a good quiz is, none of our machinery (`src/quiz.ts` comment).
- Keep `plainWords("ask","explain")` section; don't fight it (`prompting-guide.md`).
- Do not make the new rule conflict with "KEEP TO WHAT MATTERS" and "cover the piece": a worked example can be where the takeaway lives, so the rule is "ask about the principle the example illustrates, not the example's particulars (numbers, named cases)" — not "never touch them". Name this trade-off to Greg (simplest-version-first).
- Measurement (`prompting-guide.md`): run OLD prompt twice (control wobble), then new; arms separated in time by commit; hash of `src/quiz.ts` recorded; pairs shuffled with `blindCoin`, key in its own file and balance checked; blind judge in a fresh subagent that reads only the pairs file, asking (a) does the question depend on a worked example's specifics, (b) did coverage of the takeaways get worse; result must exceed the control spread; read outputs anyway. A few dollars per paid run; spend goes through the AI gateway, tracked by existing quiz cost wiring (`cost-tracking.md`, not opened).
- Test first: failing test pinning the new wording before the edit; `npm test`, `npm run typecheck`, lint on touched files; `npm run check` read later.
- Cross-family review (GPT Sol) of plan, then of code; plan doc under `docs/plans/` via `npx tsx scripts/plan-name.ts`; work in a worktree, commit by name, push to `dev`.
- Bumping `PROMPT_VERSION` makes every stored quiz outdated (silent since 2026-09-29); `quiz-step-registration.test.ts` may reference the version.

## 5. Where I got lost
- No doc defines "the article's worked examples" or says whether any quiz question should or shouldn't touch them; I inferred the design from the prompt's own rules (premise "context is not a premise", "keep to what matters").
- Two eval harnesses exist (`quiz-build-up`, `quiz-reading-goal`) with overlapping machinery; unclear which one to extend. `quiz.md` lists only `evals/quiz.ts` under Eval, not the other two — a signpost gap.
- I did not need an article with worked examples; choose a few local articles that clearly have them (paper with a toy example), but which ones exist is only knowable from the database; unchecked.
- Did not read `cost-tracking.md` or `new-mode.md`; assumed no new AI call is added.

## 6. Confidence
7/10 on files, rules and method; 5/10 on whether the rule's wording will cleanly avoid examples without hurting takeaway coverage (needs the measurement).
