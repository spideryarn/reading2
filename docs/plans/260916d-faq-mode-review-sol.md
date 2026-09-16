The core definition is good, but v1 should be simpler and more honest: model-suggested questions paired with verified article excerpts—no `unsettled` status, generated answer, or inherited question IDs.

### F1 — P1 — `unsettled` cannot make the claim its UI makes

Evidence: The mode is defined as questions “where the piece itself answers each one” ([plan:22](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:22)), yet includes questions whose answer may be no ([plan:33](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:33)). The wireframe says “NOT SETTLED IN THE PIECE” ([plan:67](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:67)), while later copy retreats to “The model could not find…” ([plan:100](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:100)).

Requiring a passage also rewards an `unsettled` row for attaching any real but potentially irrelevant quote. `findQuote` cannot validate “nearest” or absence.

Recommended change: remove `status` and `unsettled` from v1. Keep only questions for which the model identifies passages that respond. Defer “questions the piece leaves open” as a separately labelled, explicitly interpretive feature.

### F2 — P1 — The collapsed short answer is the wrong v1 choice

Evidence: The plan adds a model-written synthesis despite acknowledging that the passages are the answer ([plan:109](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:109)). The vision says generated text should route into prose rather than substitute for prose ([vision.md:59](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/project/vision.md:59)). Quiz is not a transferable precedent: it needs a reference after the reader writes an answer and explicitly admits that reference answers are sometimes wrong ([quiz.md:203](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/project/quiz.md:203)).

“May not say anything the passages do not support” is only a prompt request. Neither quote verification nor parsing tests semantic entailment. A second model check would remain probabilistic and add unjustified machinery.

Recommended change: take Fable’s recommendation for v1. The article excerpts are the answer. If the field remains, call it “the model’s short reading,” state that support is not mechanically verified, and never present it as the article’s own answer.

### F3 — P1 — “Found and checked” overstates what is verified

Evidence: The comparison table promises article passages “found and checked” ([plan:48](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:48)). But an existing block ID and matching words prove only that the passage exists, not that it answers the question. Ideas documents precisely this laundering risk ([ideas.md:130](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/project/ideas.md:130)).

Recommended change: scope the promise precisely: “The displayed words are verified verbatim; the question–passage pairing is the model’s reading.” Put that distinction in the mode card and FAQ project doc.

### F4 — P1 — The cited Ideas validator is unsafe for displayed quotations

Evidence: The plan explicitly copies `validateOccurrences` ([plan:88](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:88)). That calls default, forgiving `findQuote` and retains the model’s string. The matcher documents this as a known gap: forgiving mode can accept `fall a part` for `fall apart`, and displayed quotations must use `"spaced"` and store the article slice ([quote-match.ts:238](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/quote-match.ts:238)).

Recommended change: use the Citations discipline: `findQuote(block.text, quote, undefined, "spaced")`, then store `block.text.slice(start, end)` ([citations.ts:244](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/citations.ts:244)). Add a regression where split-word text is rejected and curly punctuation is accepted but replaced with the article’s exact characters. `articleWithIds` remains the right renderer; Quotes’ global location strategy is unnecessary unless unique relocation is deliberately added and counted.

### F5 — P2 — The density heuristic encourages summary-shaped padding

Evidence: “One per ~600 words, clamped 4–12” ([plan:95](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:95)) combines with reading order to suggest coverage across the article. That pressure is likely to produce “Why does the author discuss X?” section summaries. Ideas already records that asking for excess entries produces themes ([ideas.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/ideas.ts:108)); Quiz treats twelve strictly as a ceiling because targets cause padding ([quiz.ts:61](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/quiz.ts:61)).

Recommended change: make 12 the only hard quantity. Treat any word-derived count as an upper budget, with zero/fewer explicitly valid and no minimum. Add prompt rules against section coverage and evaluate real runs by classifying each row as genuine FAQ, Summary, Ideas, Quiz, or unsupported.

### F6 — P2 — ID inheritance serves no v1 consumer

Evidence: IDs are inherited by normalized question text ([plan:83](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:83)), while the plan explicitly has no `?faq=` address ([plan:106](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:106)) and no stored per-question reader state. Quiz deliberately omits inheritance under exactly those conditions ([quiz.ts:124](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/quiz.ts:124)).

Recommended change: omit persistent question IDs and the baseline read in v1. Add them with the first durable consumer. Use normalized question text now to deduplicate the current batch, not to preserve identity between batches.

### F7 — P1 — `drizzle-kit generate` will not add the step-name CHECK

Evidence: Stage 1 describes the column and CHECK as generated by `drizzle-kit generate` ([plan:144](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:144)). The mode checklist explicitly says Drizzle cannot see that CHECK expression ([new-mode.md:207](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/project/new-mode.md:207)).

Without the manual widening, FAQ generation will fail when its step run is recorded.

Recommended change: state that Drizzle generates the column and snapshot, then manually widen the latest migration’s `revision_step_runs_step_name_check` and the hand-kept copy in `src/db/schema.ts`. Require `tests/db-step-constraint.test.ts` in Stage 1.

### F8 — P1 — Empty and all-invalid results have no defined outcome

Evidence: Individual unanchored questions are dropped ([plan:90](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:90)), but the plan does not say what happens when every row is dropped or when the model returns `[]`. Quiz makes this distinction explicit because an all-dropped artefact otherwise records permanent success ([quiz.ts:111](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/quiz.ts:111)).

Recommended change: define three outcomes:

- Missing/non-array answer: fail.
- Model returned candidates but validation removed all: fail with counters; write nothing.
- Model deliberately returned `[]`: either accept it as an honest high-bar result and draw “No qualifying questions found,” or declare that impossible and fail. Given F5, accepting it is more coherent.

Test all three.

### F9 — P2 — `faq` is not explicitly added to `FORCE_ONLY_WHEN_NAMED`

Evidence: Stage 1 lists compiler-enforced totals but not this untyped residue ([plan:139](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:139)). The pipeline explains that independent, stamped artefacts belong in this set so an earlier forced step does not buy an unnecessary model call ([pipeline.ts:367](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/pipeline.ts:367)).

Recommended change: explicitly add `faq` to `FORCE_ONLY_WHEN_NAMED` and test the cascade. Following the Citations commit may lead there, but the plan should name the spending decision.

### F10 — P2 — Field bounds and output budgeting are unspecified

Evidence: Up to 12 rows may each contain a question, an answer, and three quotations ([plan:85](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:85)), but there are no character caps or `base + rows × per-row` answer estimate. Existing quote code documents that an undersized allowance loses the entire pass ([quotes.ts:204](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/quotes.ts:204)).

Recommended change: specify and enforce question and passage-length caps—plus answer caps if F2 is rejected—then derive the `budgetFor` estimate from those constants. Overlong quotations should be dropped, not truncated inside quotation marks.

### F11 — P2 — The cache and freshness claims need their exact inputs stated

Evidence: The plan infers cache membership from “messages wire, `articleWithIds`, high effort” ([plan:79](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:79)). Cache sharing also requires byte-identical request placement and the same block subset. Freshness inputs are not explicitly defined.

Recommended change: state that FAQ sends `blocks.filter(isBodyEvidence)`, places the byte-identical `articleWithIds` block first with its breakpoint, and puts FAQ instructions afterwards. Define whether the tree skeleton is in the prompt; fingerprint every prompt input with the same function in generation and the step stamp, using the real nullable metadata and matching fallback title. Add stage-stamp-agreement and missing-meta tests. Record explicitly that profile is absent from both prompt and stamp in v1.

### F12 — P2 — Reading order and duplicate canonicalization are underspecified

Evidence: Rows sort by “the first passage” ([plan:93](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:93)), but the model may return a later passage first. Duplicate questions and duplicate passages are also not addressed.

Recommended change: deduplicate normalized questions before the cap; deduplicate passages by `{blockId,start,end}`; sort passages in document order; and rank a question by its earliest surviving passage, independent of model array order. Test a later-first response.

### F13 — P2 — The stages are not independently reviewable before commit

Evidence: The only code review is Stage 3, after both implementation stages ([plan:162](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode.md:162)). The repository requires a GPT Sol review at the end of every stage and before commit ([AGENTS.md:235](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/AGENTS.md:235), [AGENTS.md:319](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/AGENTS.md:319)).

Recommended change: end Stage 1 and Stage 2 separately with their scoped tests, typecheck, write-capable Sol review, review-diff inspection, rerun gates, then commit. Keep Stage 3 for the full suite and bookkeeping.

### F14 — P3 — The named cache-group documentation will become false

Evidence: FAQ is deliberately added to the high-effort IDs group, but the plan only names the new FAQ/read-view/experimental docs. `prompt-caching.md` still enumerates the group as Ideas, Timeline, Quiz, and Sketch ([prompt-caching.md:43](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/project/prompt-caching.md:43)); `STEP_ORDER` comments do the same ([step-order.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/src/step-order.ts:97)).

Recommended change: include the cache-group and fingerprint named lists/comments in Stage 1’s documentation sweep.

The choices I would retain are `articleWithIds`, capable/high, body-only evidence, replace-on-rerun, owner-only experimental access, no scores, and `NO_FOUND` while cards provide explicit block jumps.

Verdict: **approve with changes**.