## Findings

### F1 — P1 — The primary run does not measure the answer that would ship

The eval uses an 8,000-token ceiling, while production uses 4,000, and that ceiling covers reasoning as well as visible output. A model that only succeeds with the extra budget can win this eval and then truncate in production. The problem is compounded by endpoint-specific handling: comments keep truncated answers, glossary refuses them, and Citations refuses them and also applies a quote guard. Direct `runStream` output bypasses those delivery rules.

Evidence: [plan:107](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:107), [dig-deeper.ts:88](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/dig-deeper.ts:88), [ai-call.ts:820](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/ai-call.ts:820), [explain.ts:701](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/explain.ts:701), [term-lookup.ts:461](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/term-lookup.ts:461), [citation-investigate.ts:1081](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/citation-investigate.ts:1081).

Fix: make 4,000 the primary ceiling. An 8,000 run can remain a diagnostic answering “would more budget rescue this arm?” Apply each entry point’s real acceptance semantics and report delivered-success rate separately from the quality of successful answers.

### F2 — P2 — Freezing search is right, but the no-tool prompt is not neutral

Holding the forced Luna search and its evidence fixed is the right way to isolate answer writing. Removing the answer model’s web tool is also reasonable for that isolated comparison. Leaving “search again” in the prompt, however, gives every model an impossible instruction. Models differ in whether they ignore it, admit they cannot comply, or pretend they searched, so the distortion is not necessarily equal.

The forced-search probe does not close that gap: production gives the answer model an optional server tool, whereas the probe forces a tool call. The earlier measurement already showed those are materially different behaviours for Opus.

Evidence: [plan:68](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:68), [explain.ts:404](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/explain.ts:404), [261001p:76](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:76).

Fix:

- For the isolated run, replace only that instruction with an eval variant saying the frozen evidence is all the available research and no further search is possible.
- Then run a small production-shaped finalist check—Opus plus the best two candidates—with the optional tool restored, 4,000 tokens, production routing and full endpoint handling.
- Shrink the forced-search probe to a compatibility diagnostic for finalists; do not treat it as evidence of production search quality.

### F3 — P1 — “First press” and “repeat press” costs would not be comparable production costs

Three effects contaminate the labels:

- `opus-b` and the Opus checker share the direct Opus arm’s cached prefix, so their observed “first” calls are warm. Marking that fact does not recover the cold cost those configurations would incur if deployed alone.
- Production `dig-deeper` pins Anthropic routing to preserve its cache; `eval` has no `order` and forbids fallback. That can change cache hits, latency, reliability and sometimes quality.
- Citations already has a measured cross-press cache miss even with production’s pin, so “runs 2 and 3” cannot automatically be called repeat-price observations.

Evidence: [plan:166](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:166), [ai-call.ts:406](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/ai-call.ts:406), [ai-call.ts:728](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/ai-call.ts:728), [261001p:268](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:268).

Fix: use route policies matching the configuration that would ship. Treat a repeat as measured only when the same upstream reports a cache read covering the expected prefix; otherwise report it as a miss, not as a repeat-price sample. For configurations sharing one model and prefix, measure one genuine cold prefix write and reconstruct each configuration’s cold scenario explicitly, or run dedicated cold trials after expiry. Exclude `opus-b` from the cost frontier.

`usage.cost` is the correct settled OpenRouter charge, but it is a credits figure, not bank cash; cash is about 5.5% higher when buying credits. Label both correctly. See [cost-report.ts:30](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/cost-report.ts:30).

### F4 — P1 — The reported latency is answer-call latency, not per-press latency

The plan adds shared preparation to cost but not clearly to latency. A real press waits for forced search; Citations may also wait for lookup, paper fetch and passage finding. Its first and repeat presses differ because an assessed lookup is skipped on later presses.

For `luna+opus-check`, raw stream time-to-first-token is especially misleading: Luna’s draft cannot be shown yet, and the checker’s first token may be `OK`, not a reader-visible answer. The reader’s first word arrives only after the checker has made an actionable decision.

Evidence: [plan:125](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:125), [plan:160](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:160), [citation-investigate.ts:877](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/citation-investigate.ts:877), [citation-investigate.ts:970](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/citation-investigate.ts:970).

Fix: report two columns: incremental answer-model latency and full reader-perceived press latency. Define separate Citation states for “lookup needed” and “lookup already assessed.” For the checked arm, measure time until the final accepted answer can actually be emitted.

Also replace the brittle `OK` protocol with validated structured output such as `{action:"keep"}` or `{action:"replace", answer:"…"}`. Otherwise `OK.`, commentary, or an empty replacement can silently become the reader’s answer.

### F5 — P1 — The judging can rank this set, but cannot support the proposed absolute conclusions

Twelve answers in one call create contrast effects, anchoring and score compression. This repository already records an eval where identical material received different absolute scores after the arm set changed. Therefore “overall 7.8,” “acceptable,” and similar absolute readings are set-dependent.

The plan also does not predeclare:

- how the four criteria and overall score become “quality”;
- what makes an answer acceptable;
- how factual errors override a high average;
- what mathematical rule names “best value.”

Additionally, the Citation arms see `matched` and `paper` evidence, while the judging section promises only the article and frozen `findings`. A judge cannot verify claims derived from omitted paper passages.

Evidence: [plan:131](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:131), [plan:202](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:202), [evals/results/README.md:45](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/evals/results/README.md:45), [citation-investigate.ts:524](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/citation-investigate.ts:524).

Fix:

- Use smaller balanced judging batches with a common Opus anchor, then pairwise judging against Opus for the finalists.
- Give judges the exact complete evidence bundle the answer saw, including matched-page and paper evidence.
- Predeclare the primary aggregation. Accuracy and sourcing should be acceptability gates, not merely two interchangeable points among several.
- Report the Pareto frontier. Do not name one arm “best value” until Greg supplies the quality-versus-money trade-off.
- Require each factual-error claim to point to the evidence contradicting it.

### F6 — P2 — `opus-b` measures only one part of the noise

`opus-b` is useful as an incumbent generation-variance control. Because both Opus outputs are scored in the same judge call, however, it does not measure judge repeatability. One Opus gap also cannot be treated as a universal noise floor for models with different output variance.

The three-family panel is defensible; Kimi’s lack of caching and speed are cost concerns, not reasons by themselves to remove the third family. But outside-family averages use different judge subsets for Opus, Sol and Kimi and therefore are not directly comparable primary scores.

Evidence: [plan:148](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:148), [plan:153](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:153).

Fix: retain `opus-b`, rename its result “incumbent generation spread,” repeat an identical judging packet on a subset to measure judge stability, and estimate uncertainty over examples rather than using one aggregate gap as a threshold. Use all-judge comparisons as primary and leave-one-family-out results only as sensitivity checks.

### F7 — P1 — The spend cap cannot be enforced from accrued cost alone

The next call’s actual `usage.cost` is unknown before it starts. Checking only the cost already accrued can therefore start a call that pushes the run beyond the cap. A missing usage frame or a crash after payment but before the run file is updated can make the total look safely low.

The estimate is plausible as an order of magnitude, but the judge estimate is optimistic: previous Opus answers used about 1,350–1,750 output tokens each, so twelve answers are roughly 16,000–21,000 tokens before the article and rubric—not the plan’s approximately 6,000. The examples are also still TBD, so the preflight has not yet established the bill.

Evidence: [plan:182](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:182), [plan:190](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:190), [261001p:241](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md:241), [declared-spend.ts:216](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/evals/declared-spend.ts:216).

Fix: before each call, reserve a conservative uncached upper bound using known input tokens, the model’s maximum output and tool fees; reconcile it to settled cost afterwards. Halt on absent/non-finite cost rather than treating it as zero. Capture, probe, answers and judging must share one durable run budget across separate CLI invocations. Recompute the estimate after the six examples and final judging layout are fixed.

### F8 — P1 — The planned tests do not cover the most dangerous silent-success paths

The stage-2 tests cover a missing judge label, but not:

- duplicate or unexpected labels, out-of-range/non-integer scores, or extra/missing cells;
- a shuffle key that is balanced but decodes the wrong arm;
- a response served by a different model/version than requested;
- unsupported `response_format`, context length, reasoning effort, or token parameter;
- a “repeat” with no meaningful cache read;
- blank/identical answers, missing usage, unknown cost, or incomplete runs;
- resume files created under an older prompt, request, model list or frozen input.

A well-formed partial JSONL could otherwise become a confident report with the hardest failures absent.

Evidence: [plan:198](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:198), [plan:210](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:210). The existing hierarchy eval already uses an expected-cell manifest and refuses quotation without `completedAt`: [hierarchy run:172](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/evals/structure-whole-document/run.ts:172).

Fix: write the complete expected matrix before spending and set `completedAt` only after exact equality. Key every resumable cell by hashes of the full outgoing request, frozen evidence, arm config, judge prompt/schema and source commit. Record requested model, returned model, generation ID and upstream; fail unexpected model resolution. Test shuffle encoding and decoding with sentinels, not balance alone. Mutation-test these guards so each has been seen to fail.

### F9 — P1 — Raw frozen inputs must not be committed

The frozen input contains web excerpts, paper chunks/passages, and potentially text, titles and slugs from the reader’s other saved articles. `evals/results/` is a committed-results area, and the plan explicitly contrasts the uncommitted article with the frozen input there. That would publish real reader material and third-party prose into git.

Evidence: [plan:55](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:55), [plan:198](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/docs/plans/261001s-dig-deeper-answer-model-eval.md:198), [dig-deeper.ts:443](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/src/dig-deeper.ts:443). The established convention explicitly puts judging material containing real article prose in gitignored output and promotes only aggregate results: [evals/results/README.md:166](/home/greg/code/spideryarn2/.claude/worktrees/dig-deeper-eval/evals/results/README.md:166).

Fix: put raw inputs, answers, keys and judgments under a gitignored run directory. Commit only hashes, model/config provenance, aggregate tables and carefully reviewed short error descriptions. Use synthetic or explicitly licensed fixtures if a fully reproducible committed example is required.

The core experiment is worth doing: six cases, fixed evidence, three draws, a multi-family panel and provider-reported costs are a solid foundation. The material changes are to make the primary run production-shaped, separate isolated writing quality from end-to-end behaviour, harden the cost/cache semantics, and keep raw reader material out of git.

**Verdict: build after fixes.**