Build with changes. No P0s, but the proposed priority rule and eval design need revision before implementation.

## 1. Product design

1. **P1 — Plan lines 53–79: the threshold is not the requested compound.**  
   Centrality decides admission and difficulty independently decides order. Calling that pair “the compound” does not make the slider a compound threshold. It also produces odd results: a broad but barely relevant question (`d=.05, c=.31`) precedes a central question that requires some context (`d=.35, c=1`), while raising the slider can never remove a dense but central question.

   **Fix:** use one explicit priority:

   ```ts
   priority = centrality * (1 - difficulty)
   ```

   This is the direct FAQ analogue of the Glossary product: central and accessible questions score highest. Gate on it. For the simplest v1, order survivors by this priority descending, with reading order as the tie-break. If repeat runs show unstable rankings, fall back to compound-gated reading order; do not replace one unstable composite with an equally unstable raw-difficulty sort.

   Also fix “peripheral questions go first” on line 63: the proposed gate makes peripheral questions disappear first.

2. **P2 — Plan lines 39–45 and 71–73: the score called `difficulty` is actually specificity or depth.**  
   A broad question can be intellectually difficult, and a narrow detail can be easy. The proposed definition measures how local/specialised the question is, not how difficult it is. `ScoreBars` would consequently tell readers “Difficulty: .80” while meaning “arises deep in a technical detail.” A longer difficulty bar also points in the opposite direction from a longer centrality bar: one lowers priority, the other raises it.

   **Fix:** preferably call the axis `specificity` or `depth`, with a tooltip such as “How far into the piece this question arises.” If the stored field must remain `difficulty`, define it as actual reader difficulty and stop claiming that it directly measures high-level versus low-level. In either case, test the labels with the resulting rows rather than inheriting the Glossary wording unchanged.

## 2. Prompt

3. **P1 — Plan lines 29–32: both proposed “big question” examples weaken the FAQ’s defining boundary.**  
   “Why should we think X at all?” invites a tour of the evidence. “What would have to be true for the main claim to fail?” invites a model-generated counterfactual the article may never answer. Both can reintroduce whole-piece summaries or unanchored questions despite [the current prompt’s rules](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/src/faq.ts:382).

   **Fix:** describe broad questions as pressure on the central claim, not requests to restate or generally support it. Suggested wording:

   > Among the questions that genuinely arise, include up to three broad pressure questions about the piece’s central claim. A broad question must name a specific objection, dependency, tension, or implication that remains after understanding the claim, and the piece itself must respond to it in one to three passages. Do not ask for the thesis, main argument, conclusion, evidence in general, or a tour of how the sections support it. Do not invent a broad question to reach a count.

   Add explicit bad examples: “Why should we believe the main claim?”, “What evidence supports it?”, and “How does the article develop its argument?” Keep the existing fridge objection as the positive example: it is broad because it pressures the central claim, but specific enough to answer without summarising the article.

## 3. Reuse and slider arithmetic

4. **P2 — Plan lines 85–98: extracting the pure arithmetic is appropriate; migrating two established sliders is optional scope.**  
   Moving `GATE_STEP`, `floorToGateStep`, data-derived top, rendered maximum, and the “can this threshold act?” predicate into [threshold.ts](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/src/web/threshold.ts:1) removes a real third copy and breaks Citations’ current dependency on `GlossaryPanel`. That is good reuse.

   Moving both mature panels onto a new React component during the feedback fix broadens the regression surface. “If their tests stay green untouched” is not enough: accessible names, reset defaults, titles, IDs, counts, and foot copy can change while current tests remain green.

   **Fix:** make the arithmetic extraction part of this work. Either defer the shared component, or make it a deliberately dumb component receiving primitive values such as `value`, `max`, `visibleCount`, `total`, `defaultValue`, `note`, `id`, and accessible copy. Land the Glossary/Citations migration separately with equivalence tests and a browser check.

5. **P2 — `floorToGateStep` move: preserve the distinction between data top and rendered maximum.**  
   [GlossaryPanel](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/src/web/GlossaryPanel.tsx:686) has hard-won edge cases: close scores on the hundredth grid, all scores below `.01`, and an off-range URL threshold. `canThreshold` must be derived from `thresholdTop`, never from `thresholdMax`, because the latter includes the current URL value.

   **Fix:** retain wrapper exports, including `GATE_STEP`, and pin this invariant generically:

   ```ts
   canThreshold(items, scoreOf) ===
     applyThreshold(items, thresholdTop(items, scoreOf), scoreOf).hiddenCount > 0
   ```

   Preserve tests for `.501/.509`, `.005/.009`, floating-point `.57/.58`, and a current threshold above the data maximum.

## 4. Contracts and likely breakage

6. **P1 — [faq.ts’s answer budget](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/src/faq.ts:103) is omitted from the plan.**  
   `ANSWER_TOKENS` says it is derived from every output field. Two numeric fields and their JSON keys add output per question. Leaving the formula unchanged makes its documented guarantee false and increases the chance of a whole-run truncation failure at the twelve-question boundary.

   **Fix:** add both score fields to the per-question answer-size calculation and extend the test that says the budget is derived from the caps.

7. **P1 — Public scores can silently disappear unless the projection test becomes score-bearing.**  
   The plan correctly names [publicFaq](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/src/public/dto.ts:485), but `FaqQuestion` will need optional score fields for legacy artefacts. That means omitting them from the field-by-field DTO will still typecheck. The existing exact public-key test uses a question with no scores, so it would also remain green unchanged.

   **Fix:** add both scores to the public DTO, put nontrivial values on the FAQ fixture in [public-dto.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/tests/public-dto.test.ts:1010), and assert both exact keys and values. Separately render a genuinely legacy question without either field.

8. **P2 — Validation does not specify duplicate-score semantics.**  
   [toQuestions](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/src/faq.ts:239) merges duplicate questions and their passages. The plan does not say which duplicate’s scores survive, whether a later valid score fills an earlier missing one, or which raw items contribute to absent/rejected counters.

   **Fix:** make the rule explicit. The simplest is: first occurrence owns question text and scores; later duplicates contribute passages only; every otherwise readable raw question is counted before deduplication. Test missing, `null`, out-of-range, zero, and conflicting duplicate scores. Reuse the validator, but give FAQ its own counter type or move the structural counter helper to a neutral module rather than exposing `GlossaryScoreDrops` as an FAQ concept.

9. **P2 — URL/controller scope and pinned descriptions need correction.**  
   The plan says `?faqorder=` is spelled like `?citeorder=`, but Citations actually uses `?citeby=` in [CitationsMode](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/src/web/modes/citations/CitationsMode.tsx:92). It also says “Reader wiring,” although URL controls belong in [FaqMode](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/src/web/modes/faq/FaqMode.tsx:1), shared by owner and visitor.

   **Fix:** choose `?faqby=` for consistency, or retain `?faqorder=` as an explicit naming decision. Add `useFaqControls` in `FaqMode`, not `Reader`. Update:

   - The FAQ panel test that currently requires no head row.
   - The mode controller’s “no URL parameters” contract.
   - `FaqPanel`’s “No scores, no threshold bar” comment.
   - [mode-catalog.ts](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/src/mode-catalog.ts:440), which currently promises reading order and says no priority score exists.
   - `faq.md`’s stored-order description.

   Caching itself is sound: `FAQ_SYSTEM` remains after the cached article block, so changing it does not disturb the shared article prefix. Keep the existing byte-equality cache test. No database migration is needed, and legacy JSON is safe if the two fields are optional.

## 5. Eval

10. **P1 — Plan lines 119–126 cannot separate the effect from generation noise.**  
    Two old generations and only one new generation estimate control variance but not treatment variance. Comparing the same `after` sample against both controls creates apparent replication without another treatment draw. Three articles make this especially fragile. The comparison also changes prompt, scoring, thresholding, and ordering simultaneously, so it measures the bundled UI outcome, not the required prompt change. Finally, the corpus substitutes “a dense paper like Greg’s” for the exact article that produced the report.

    **Fix:**

    - Include the reported article, or record why it cannot be reproduced.
    - Run at least two old and two new generations per article.
    - Use more than three articles if this result is meant to choose the default threshold; six varied articles is a reasonable small evaluation.
    - Evaluate two questions separately:
      1. Old versus new output under the same presentation, to measure the prompt.
      2. New reading order versus new prioritised order, to measure the UI rule.
    - Score each opening for high-levelness, centrality, usefulness, and the existing forbidden classes—not only a pairwise winner.
    - Measure top-three overlap or rank correlation between the two new runs. That directly tests whether ordering by a noisy score is stable enough.
    - Predeclare “most entries” numerically, tune the default on a calibration subset, and confirm it on held-out articles. A threshold chosen and judged on the same three outputs is not evidence that it generalises.

    With the current three-arm design, a positive result could easily be one unusually good `after` draw; a negative result could be one unusually poor one.

**Verdict: build with changes.**