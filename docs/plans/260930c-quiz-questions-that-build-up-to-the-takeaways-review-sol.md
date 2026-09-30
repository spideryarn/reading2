# Plan review: quiz questions that build up to the takeaways

The path is a good response to the new request, but the plan should not retire adaptivity as written. A fixed conceptual order and adaptive scaffolding are compatible, and that version also gives a cleaner answer to the premise/giveaway problem. There are no P0s; the P1s below should be resolved before implementation.

## Findings

### F1 — P1 — Retiring adaptivity is not required, and removes a chosen behaviour without a replacement

**File/section:** `docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md` § The one thing this collides with, and the call; § Deferred, named

The plan proves that the **current band-hopping ladder** cannot walk a prerequisite chain. It does not prove that adaptivity and a chain are incompatible. Greg previously chose an adaptive quiz to achieve “start easy, stay at the right level” without a visible control; the new request does not say to remove that behaviour. “Every step is small” starts everyone in the same place, but it does not keep the quiz fitted to the reader: somebody who has the piece cold and somebody who missed the previous idea receive exactly the same next wording.

There is a simpler adaptive path than branching or marking skippable stepping stones: have the model return an optional `premise` separately from the question stem. The conceptual order never changes. After a right answer, show the next stem without restating the premise the reader just established. After a wrong answer, no verdict, a skip, or a manual jump, show `premise + stem`. That preserves the existing hidden verdict and fixed path, adds one field rather than a dependency graph, has no difficulty control or label, and makes the adaptation pedagogical: more scaffolding when it is useful, less giveaway when it is not. The visible mark already supplies the correction after a wrong answer.

**Fix:** revise the plan around adaptive premise disclosure and measure it beside the non-adaptive path. If the product still prefers to delete adaptivity, get that decision explicitly before building; the 2026-09-06 choice should not be implicitly superseded by a request that did not mention it.

### F2 — P1 — The migration account is false in both client/server directions

**File/section:** plan § The stage, lines 112–121; `src/web/QuizPanel.tsx` § `Staleness`; `src/web/quiz-ladder.ts` § `nextQuestion`

Old stored JSON having extra `band` and `value` fields is harmless to a new client. The rest of the paragraph is not true. Since commit `f46e2dc7`, prompt-version `outdated` is deliberately silent: `QuizPanel` does not offer *Write them again*, and its comment quotes Greg’s 2026-09-29 decision that prompt changes are not worth bothering the reader about. A quiz/4 artefact therefore remains visible and usable. The new client will walk its old band-sorted pool in array order and call it a path, even though the questions do not build on one another.

The reverse direction is worse. A tab with the old client bundle can fetch a newly generated quiz/5 artefact. With `band` removed, it calls `nextQuestion(..., question.band, ...)` with `undefined`; `SEARCH[verdict][from]` has no row, so Next throws at runtime. Removing the optional `verdict` from `done` is backward-compatible—the old client already treats absence as “hold”—but removing `band` from the wire is not.

**Fix:** define an artefact/wire migration rather than relying on TypeScript’s tolerance for extra fields. The smallest deployment bridge is to keep compatibility `band`/`value` fields for one release and synthesize the same band for every new path question; an old ladder then walks them sequentially when the verdict is absent, while the new client ignores them. Add tests for a new client reading quiz/4 JSON and an old-client ladder reading quiz/5 JSON. Separately decide whether legacy pools remain as legacy pools until a Metadata rerun, or whether this shape change warrants explicit invalidation; correct the plan either way.

### F3 — P1 — The premise rule creates a cross-question giveaway that Show all cannot simply waive

**File/section:** plan § The prompt, lines 87–100; § The walk, lines 126–135; `src/web/QuizPanel.tsx` § `QuestionList`

“It must never contain its own answer” covers only one leak. A later premise can reveal an **earlier** question’s answer before the reader answers it. Show all is not merely a spoiler switch: Greg’s original quiz request made revealing a batch and choosing which question to answer a normal workflow. Scanning that picker should not answer the earlier rows. The current eval’s `giveaway` question also checks only whether a question contains its own answer, so it would certify the exact cross-question leak the new rule introduces.

The rule also encourages the suspected failure mode: a hard synthesis question can remain hard while acquiring a “Given X” prefix. The prefix makes the wording look incremental without reducing the new inference demanded.

**Fix:** keep premise text structurally separate. Show only stems in the all-questions picker; reveal the premise when a reader opens a later question out of order, or adaptively as in F1. Expand the eval to score (a) own-answer leakage, (b) a later row revealing an unanswered earlier row, and (c) a premise bolted onto a question that still requires a large synthesis step. Add bad/good prompt examples for the third case.

### F4 — P1 — Dropping a middle question can sever the path, and the existing counters cannot reveal that

**File/section:** plan § The stage, lines 122–124; `src/quiz.ts` § `toQuestions`

The acceptance argument assumes every successor restates everything it needs. The proposed prompt says a later question **may** state an earlier result as a premise, not that every dependency is repeated. Even when it does, restating the conclusion does not replace the reasoning the missing question was meant to make the reader perform. A dropped “why X?” followed by “Given X, what follows?” leaves a syntactically answerable question but removes the understanding the path was supposed to build.

The artefact’s counters are totals by rejection reason. They do not record raw ordinals, so they cannot distinguish a harmless dropped tail item from a gap at question 4 with sixteen accepted successors. The claim that the existing counts will show this happening often is therefore false.

**Fix:** make path validation fail closed on an internal gap: preserve raw ordinals and reject a batch when a dropped item has an accepted successor. Tail drops can still degrade. If that proves too failure-prone, add explicit predecessor metadata and drop dependants transitively; do not silently splice a dependency path. Test first, middle, and tail drops separately.

### F5 — P1 — The blind judge cannot assess fidelity or arrival at the article’s takeaways

**File/section:** plan § Measuring it, lines 169–179; `evals/quiz-build-up.ts` § `pairs`

The pairs file contains only the two sets of questions and reference answers. It contains no article text, outline, or evidence quotes. A judge that reads only that file cannot tell whether a question is settled by the article, whether a reference answer bends it, or whether the endpoint is one of the article’s key takeaways. Mutually consistent invented prose can score perfectly. The stored `evidence` is only a list of block ids and is not rendered into the pair.

Five whole-quiz pairs are adequate for the plan’s modest qualitative claim—catch a regression and see whether a path exists—but only if the judge has the source. The acknowledged count-based unblinding limits effect-size claims; it is not the main defect.

**Fix:** include a source pack inside the blinded file for each slug: at minimum the article skeleton plus all exact evidence passages, and preferably the article text once before X/Y. Then ask separately whether the final questions reach the source’s takeaways and whether each question/answer is supported. Keep the current warning that five pairs do not measure how much better the change is.

### F6 — P1 — The eval silently accepts incomplete or mismatched arms

**File/section:** `evals/quiz-build-up.ts` lines 61–69 and 97–141

`pairs` builds two maps and silently continues when the second arm lacks a slug. It does not reject an extra slug on either side, duplicate slugs, a file whose `arm` disagrees with its directory, or a control whose prompt version/source hash differs from `before`. An accidentally partial run can therefore produce a plausible three-pair file and call itself the five-article comparison.

The pairing unit and coin are otherwise sound: whole quiz by slug is the right unit, `blindCoin` is tested, the key is separate, and this seed puts the changed arm on X three times out of five. Reusing the same deterministic side pattern for control and treatment is acceptable if fresh judges read the files separately.

**Fix:** before reporting or pairing, validate the JSON shape and assert exact slug-set equality, unique slugs, the planned count of five, matching recorded arm names, and identical `promptVersion` plus `sourceSha256` for `before`/`before-2`. Refuse rather than inner-join. Print and record the 3/2 side balance as it does now.

### F7 — P1 — Deleting the task registration reclassifies historical verdict spend as unknown

**File/section:** plan § Retired, lines 137–145; `src/cost-categories.ts` § `JOB_DISPOSITION` / `dispositionOf`

The conditional “unless historical spend rows need the category name” is not enough. The ledger explicitly stores historical job strings. If `quiz-verdict` leaves `AiJob` and `JOB_DISPOSITION`, `dispositionOf` returns `null`; request-scope rows then move from **interactive request work** to **unknown**. They remain printable, but the historical category totals change even though the work did not. That is a financial-reporting regression, and the code’s comments say old names are otherwise intentionally treated as unknown.

The retirement sweep also misses `src/pipeline.ts`’s band-count logging and the live descriptions in `docs/project/ai-gateway.md` and `docs/project/setup-dev.md`. The pipeline reference should fail typechecking; stale prose will not.

**Fix:** make the historical policy explicit before building. Prefer a small `RETIRED_JOB_DISPOSITION` string map consulted after the live exhaustive table, so old `quiz-verdict` rows retain their known classification without keeping a dead model task in `/api/models`. Add the pipeline log, AI gateway, setup guide, env-name inventory, `quizBandsNotSpread` message/tests, and cost-category regression to the retirement checklist. Keep the existing terminal `done` contract—`reply` and `model`, with no verdict—and a client test that such a frame still ticks the question answered. Removing only verdict labels from `evals/quiz.ts` is fine; retain all marking cases.

### F8 — P2 — Twenty and 16,000 are defensible trial values, but the eval discards the evidence needed to justify them

**File/section:** plan § Why twenty and not more / § The stage; `evals/quiz-build-up.ts` § `generate`

Twenty is a reasonable ceiling for Greg’s “more” and “a whole bunch”, and high adaptive thinking is reasonable for planning a coherent route through an article. `ANSWER_TOKENS = 16_000` is also plausible for twenty shorter answers. But `budgetFor("quiz", 16_000)` actually sends a 56,000-token ceiling after the shared 40,000 thinking reservation, compared with 50,000 today. The answer allowance grows 60%; the total allowance grows only 12%, and at high effort adaptive thinking may consume the extra room. Meanwhile “fewer where the piece does not support twenty” is an instruction, not a distribution: the incumbent commonly fills its 12-question ceiling, so 20 may behave as a target and create reader fatigue.

The generator prints `run.outputTokens` and then throws that number away. The result files cannot support the budget claim after the terminal output scrolls away.

**Fix:** record `outputTokens`, elapsed time, and the effective `max_tokens`/answer-room constants in every arm file; report them beside question count and drops. Treat 20/16,000/high as provisional and keep them only if all five after-runs finish with comfortable headroom and the blind read says the last questions are useful steps rather than padded synthesis questions. Reader completion/drop-off remains a post-release question; this eval cannot answer it.

do not build
