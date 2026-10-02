The plan is not ready to support an adoption decision. Its five-article, one-draw design can screen for large failures, but it cannot establish “no meaningful loss,” and the observed base/base-repeat gap is not a stable noise threshold.

Reviewed read-only at base `cfd0428e5a95c2da2bb5e86f8233c915bfa62bff`. No files changed.

### Findings

**F1 — P0 — The eval treats failure to detect a loss as evidence of equivalence.**

Evidence: the corpus has five independent article units, each lower arm is drawn once, and passing means the judges did not find a larger mean loss than the control difference ([plan:48–74](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:48), [plan:139–150](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:139)). Five paired articles can reveal a large, consistent loss, but cannot establish non-inferiority: even five losses in the same direction do not reach a two-sided 5% sign-test threshold. The two judges inspect the same five outputs, so they are not ten independent quality observations.

The existing Hierarchy harness explicitly says noise must be assessed per document and that challenger variance may differ from incumbent variance ([floor.ts:3–17](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/structure-whole-document/floor.ts:3)). This plan acknowledges that lower-arm variance is unmeasured, yet still permits adoption ([plan:195–201](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:195)).

Fix: reframe the five-article run as a screen for obvious degradation. A passing arm becomes a finalist, not an adoption. Confirm finalists with repeated lower-arm runs and either more articles or a declared product-level non-inferiority margin. Do not conclude equivalence from a null result.

---

**F2 — P1 — One base/base-repeat pair is not a sound noise floor.**

Evidence: the plan turns one stochastic difference per article into the threshold every challenger must clear ([plan:71–74](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:71), [plan:143–147](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:143)). A lucky near-tie makes the test arbitrarily strict; an unlucky large control gap permits a real loss. It is also unspecified whether “spread” means signed difference, absolute difference, range, or per-article versus pooled mean.

The existing harness uses ranges and MAD across multiple repeats, per document ([floor.ts:160–170](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/structure-whole-document/floor.ts:160), [floor.ts:183–251](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/structure-whole-document/floor.ts:183)).

Fix: either collect at least three baseline draws per article and repeat finalists, or use a fixed, product-defined acceptable-loss margin. Keep the repeat as a sanity check, not as a threshold estimated from one observation.

---

**F3 — P1 — The decision rule is not actually preregistered and contains contradictory tie-breaks.**

Evidence: the formal rule says every adopted arm must remain within control spread for both judges ([plan:139–149](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:139)). Immediately afterwards, “close” means keep today’s effort, Sketch and Illustrated should lean cheaper, and Ideas may accept a “modest loss” ([plan:150–156](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:150)). Those instructions permit three different outcomes from the same numbers.

Fix: specify before running:

- Exact aggregation and direction for every score.
- Treatment of ties, missing scores, validation failures, and judge disagreement.
- Whether a modest loss can pass and its numeric limit.
- Whether the objective gate or Greg’s stated leaning wins when they disagree.
- A deterministic rule for standardising Sketch and Illustrated if their independently preferred levels differ.

---

**F4 — P1 — Illustrated’s proposed baseline is not today’s request.**

Evidence: production currently sends adaptive thinking with no `output_config` ([illustrated.ts:1035–1058](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/illustrated.ts:1035)). The plan first changes it to explicit `high`, then uses that changed request as base and assumes equivalence with the default ([plan:94–100](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:94)). The central wire helper itself distinguishes omission from explicit effort and only injects `high` for the high-power Opus path ([messages-stream.ts:462–479](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/messages-stream.ts:462)).

Thus the eval never compares lower effort against the request readers receive today. A behavioral change caused by explicit `high` would be attributed to effort reduction or hidden inside the new control.

Fix: make the Illustrated override optional. Base and base-repeat must omit effort exactly as production does; only lower arms should send it. If explicit `high` is desirable independently, add an `implicit-default` versus `explicit-high` calibration before altering production.

The table is therefore accurate only for standard-power Sonnet: its `high` is implicit. On high-powered articles, `high` is injected explicitly.

---

**F5 — P1 — Hierarchy “off” and the expansion behavior are not defined tightly enough.**

Evidence: the current harness’s `CallSpec` requires a normal effort value ([arms.ts:80–91](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/structure-whole-document/arms.ts:80)), and its Messages sender always emits both adaptive thinking and `output_config.effort` ([model-arms.ts:294–328](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/structure-whole-document/model-arms.ts:294)). The plan merely says to add `thinking: "off"` ([plan:101–104](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:101)); it does not say that `output_config` must be omitted, nor how the response will prove OpenRouter honored the setting.

The expansion effort is deliberately tied to production effort ([structure-expand.ts:143–158](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/structure-expand.ts:143)), but the eval measures only the structure call ([plan:195–201](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:195)). Deepening is off in production today ([structure-step.md:791–797](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/project/structure-step.md:791)), so silently changing its future recipe gains nothing now and leaves an untested trap.

Fix:

- Make the call configuration a discriminated union: adaptive with an effort, or disabled with no `output_config`.
- Run a same-wire preflight and require zero thinking tokens, normal completion, valid JSON, and the expected upstream before the panel.
- Keep expansion at `low` by decoupling its constant, unless expansion is separately evaluated at `off`.

---

**F6 — P1 — The “paper with figures” arm will be figureless unless the plan explicitly loads production inputs.**

Evidence: the corpus describes `entropy` as the article testing figures ([plan:54–60](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:54)), but `generateIllustrated` defaults absent figures to `[]` ([illustrated.ts:1013–1025](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/illustrated.ts:1013)). Production loads stored assets and passes `figureSurvey.figures` ([pipeline.ts:4168–4223](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/pipeline.ts:4168)). The current Illustrated eval harness also omits them.

Fix: load the figures once through the production loader, pass the identical immutable list to every arm, and record its fingerprint and labels in the result. Otherwise remove the claim that the corpus exercises production’s figure path.

---

**F7 — P1 — Hierarchy’s structural gate uses measures that are not monotonic quality scores.**

Evidence: the plan would disqualify `off` for “repaired tiling” or “worse nesting” beyond control spread ([plan:133–137](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:133)). But heading snapping can improve source-heading alignment while increasing `repairedBlocks`, and the project doc explicitly says that measure over-counts and must be fixed before fitting a threshold to it ([structure-step.md:317–340](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/project/structure-step.md:317)). The score module also says several structural measures are comparisons, not “higher is better” scores ([score.ts:1–10](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/structure-whole-document/score.ts:1), [score.ts:109–152](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/structure-whole-document/score.ts:109)).

Fix: preregister structural gates by failure class:

- Hard failures, invented IDs, missing gists, dropped sections: zero tolerance.
- Repairs: compare raw repair classes and union-of-moved-block intervals, not the over-counted sum.
- Boundary/depth/fan-out differences: judge per article, with declared directions only where a direction is meaningful.
- Do not pool a stable document’s spread to excuse another document.

---

**F8 — P1 — The judging design is too ambiguous for either judge to be a hard gate.**

Evidence: Sol sees three pairs in one run per mode, with the exact same base artifact repeated in every pair ([plan:108–115](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:108)). That makes the baseline recognizable despite shuffled labels. Opus’s 1–10 scores are ordinal and unanchored; the plan does not say whether outputs are separate calls with drifting calibration or one call where they are no longer truly isolated. Nevertheless, either judge can veto adoption ([plan:143–146](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:143)).

Fix: use one anonymous, randomized lineup per article, ranking all arms with ties—the existing blind Hierarchy tool already uses that shape ([blind.ts:150–186](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/structure-whole-document/blind.ts:150)). If retaining absolute scoring, give every numeric level behavioral anchors, keep all outputs under the same calibration context, and make it supporting evidence rather than an independent hard veto.

---

**F9 — P1 — Illustrated plate differences cannot be attributed cleanly to brief effort.**

Evidence: every arm draws fresh plates ([plan:76–78](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:76)). The existing harness records that three image draws of one identical brief varied visibly, including correct, misspelt, and omitted lettering ([illustrated/run.ts:37–40](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/illustrated/run.ts:37)). With one plate draw per brief, image-model luck can decide whether a lower text-effort arm appears worse.

Fix: make the validated brief the primary causal endpoint. Draw plates only for finalists, with at least two draws per brief if plate quality is going to decide the result. Report brief quality and renderer variability separately.

---

**F10 — P1 — The savings gate can be won by the atypical 150k-character article.**

Evidence: the corpus has one 150k-character article while the normal population is described as 30–60k ([plan:54–63](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:54)). The saving gate sums tokens across all five, and the plan already expects the long article to dominate cost ([plan:84–85](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:84), [plan:147](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:147)). An arm could therefore pass while saving little on the normal articles the headline concerns.

Also, the 9–10% claim is conditional on halving all four modes’ $9.31 thinking spend: that arithmetic is sound, about 9.3% of $50.06 ([research:64–67](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md:64)). But the actual gate requires only one-third reduction, which corresponds to about 6.2% if all four pass.

Fix: gate savings per article or on the median of the typical articles, then estimate the production saving using the production length/mode distribution. State 9–10% as the halving scenario, not the guaranteed result of this eval.

---

**F11 — P2 — The call count and plate price are false.**

Evidence: the plan calls this 75 paid calls and says plates cost well under a cent each ([plan:76–85](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:76)). Illustrated performs one image call per surviving plate ([illustrated.ts:5–14](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/src/illustrated.ts:5)), and current measured cost is about $0.068 per plate, about $0.204 for three ([illustrated.md:287–300](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/project/illustrated.md:287)). Production data agrees: 33 current-model image calls cost $2.04 ([results.txt:15](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/results.txt:15)).

Thus there are 75 text-generation calls plus roughly 60–80 image calls, before smoke runs and judging. Plates add roughly $4–5.50.

Fix: budget text calls, image calls, smoke calls, retries, and judging separately, with a hard maximum spend.

---

**F12 — P2 — Generation order is left as a time/provider confound.**

Evidence: arm execution is only constrained to be sequential because the environment override is process-global ([plan:101–102](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:101)); only judging order is randomized ([plan:108–111](/home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md:108)). A fixed base → repeat → medium → low order can correlate effort with provider load or time. A thrown call can also leave the process-wide override set unless restoration is guaranteed.

Fix: use a recorded seed to counterbalance generation order per article, restore the environment in `finally`, assert it after every arm, and record requested effort and serving upstream with each result.

### Factual audit of the “today” table

For standard-power articles, Sketch=`high`, Ideas=`high`, Illustrated=implicit Sonnet `high`, and Hierarchy structure=`low` are correct. Two qualifications should be added:

- High-powered Illustrated gets explicit `high`, not implicit `high`.
- Hierarchy expansion inherits `low`, but that expansion pass is disabled for readers today.

The cache-group description is broadly correct. “At `low`, alone” is only true if Sketch and Ideas do not both move to `low`; if both move, they remain cache-compatible with each other.

### Simpler design

A cheaper design that answers the question more honestly:

1. Run `base-a`, `base-b`, and the cheapest candidate (`low`, or `off`) on all five articles, in counterbalanced order.
2. Judge one anonymous lineup per article with both judges. Treat this as screening for a clear loss.
3. If the cheapest arm clearly fails, test `medium`; do not buy `medium` pre-emptively.
4. Repeat the lower arm on articles that decide the outcome, and expand the corpus before adoption if the result is “no visible difference.”
5. For Illustrated, load production figures, score briefs first, then draw repeated plates only for finalists.
6. Keep Hierarchy expansion at `low` and preflight `off` over the real Messages wire.

This spends less when `low` clearly wins or loses, while directing repeats to the cases where variance matters.

**Verdict: reframe.** The proposed run is useful as a large-regression screen, but it should not adopt lower effort from five single draws and one observed control difference.