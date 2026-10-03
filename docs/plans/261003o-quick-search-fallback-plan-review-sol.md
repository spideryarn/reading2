Stage A cannot yet answer whether the fallback is good enough, or choose a defensible floor and cap. The replay arithmetic broadly supports the proposal, and I found no client-side assumption that quick hits are at least 70, but the evaluation design has several blockers.

### Findings

**F1 — P2 — The negative controls make a 0.5 floor look safer than the evidence warrants.**  
[plan:66](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:66), [plan:133](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:133)

Four of the five absent-topic controls are conspicuously unrelated and top out at 0.02–0.12, so none discriminates between floors 0.45, 0.5, and 0.55. The only domain-plausible negative, “human memory,” crosses every candidate floor and would return up to eight passages. One hard negative cannot estimate how often plausible-but-absent queries produce convincing noise; moreover, one zero-hit thorough run does not prove those passages are useless.

Change the plan to add independently written, domain-plausible absent or near-miss queries for every article. Report per-list outcomes—especially “any wrong result in the top 1/top 3” and “no useful result”—and predeclare what result would justify shipping. Aggregate right/wrong paragraph counts alone cannot define “good enough.”

**F2 — P2 — The judging pool cannot compare the wording arms and lacks the context needed for the proposed query class.**  
[plan:136](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:136), [plan:144](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:144)

The pool is described as passages scoring at least 0.45 “on any run,” but the other four wordings are run only afterwards. Their new hits therefore remain unjudged, so Stage A cannot say that a wording “clearly wins.” Also, whether a paragraph is a result, method, example, or criticism often depends on its section heading and neighbouring context; judging isolated paragraphs is especially unreliable for the class under investigation. Easy low-score decoys only detect an indiscriminate judge, not mistaken borderline labels.

Run every arm first, then judge the union of passages surfaced by any wording/rule plus the thorough candidates. Show the containing heading and limited neighbouring context while asking for a verdict on the target paragraph. Either use two independent blind judgements or explicitly adjudicate disagreements and ambiguous items.

**F3 — P2 — One thorough search is not a fair retrieval yardstick.**  
[plan:134](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:134), [quick-search.ts:151](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/src/quick-search.ts:151), [search.md:193](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/project/search.md:193), [prior investigation:69](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/investigations/261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md:69)

Thorough and quick search do not search the same domain. Quick excludes every heading; the saved thorough “results” run has two headings among seven hits. Thus even a perfect quick paragraph list can overlap at most five of those seven. Thorough also selects a non-exhaustive set of quoted passages and is stochastic. The earlier investigation correctly called this metric “reference recall,” not recall.

Use blind relevance labels as the primary yardstick. Treat thorough as a candidate generator and secondary comparison, call the metric “overlap with one thorough run,” and restrict it to quick-eligible non-heading block IDs.

**F4 — P2 — The candidate rules omit the simplest useful caps and do not measure the discontinuity’s effect.**  
[plan:83](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:83), [plan:107](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:107), [plan:140](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:140)

Caps 5, 8, and 20 omit 1 and 3—the strongest candidates for “most of the value with least noise.” The replayed “top up to 3” rule is not the same as “only when empty, return at most 3.”

Counting scores near 0.7 also does not measure user-visible instability. “Methods” already produces 4, 0, and 2 normal hits across three runs; the working fallback would turn that into roughly 4, 8, and 2. The proposed edge count records three nearby scores but not the radically different lists.

Add empty-only caps 1 and 3, plus the current empty result as the control. For every rule, report fallback/normal mode flips, hit-count spread, top-1/top-3 correctness, and overlap between repeated runs. Compare any smoother/top-up rule on this new judged set, not only on the earlier holdout.

**F5 — P2 — “Category word” is not a supported causal class.**  
[plan:55](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:55), [abstract-run.ts:11](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/data/qeval/abstract-run.ts:11)

The set combines discourse-role labels (“results,” “examples,” “methods”) with domain abstractions (“linear algebra,” “statistics,” “philosophy”), and several are not single words. Most members already clear 0.7; only eight return nothing on most runs, while “methods” is empty only once in three. The evidence is also consistent with an **implicit-relation/bare-label query** problem, score calibration, casing, morphology, or heading exclusion.

Use a provisional name such as “bare role or domain queries whose relevant passages imply rather than mention the query.” Stratify those two shapes and add paired controls on the same article: lowercase/title case, singular/plural, bare label/natural-language request, and explicit mention/implicit instance. Do not present “category word” as the established cause yet.

**F6 — P3 — The replay’s query count and right/wrong totals include two superseded queries.**  
[plan:91](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:91), [replay-rules.mjs:1](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/data/qeval/replay-rules.mjs:1)

I ran the replay. It reports 150 runs because the raw file contains 50 query strings: the declared 48 plus two superseded variants. Therefore “48 queries, 3 runs” cannot produce “150 runs.” The cited 93 right / 33 wrong / 174 unjudged counts are for all 50. Excluding the superseded variants gives 144 runs and 84 / 30 / 152. The empty-only fallback still changes zero prior-eval runs, so the conclusion survives.

Exclude the superseded variants or explicitly describe the 50-entry replay and use its actual provenance.

**F7 — P2 — The reproduction conflates lowercase and title-case “results.”**  
[plan:43](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:43), [plan:113](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/docs/plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md:113), [repro-jp5nxn.ts:12](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/data/qeval/repro-jp5nxn.ts:12)

The three saved lowercase “results” runs top out at 0.52–0.57. Scores around 0.64–0.67 belong to the separate title-case “Results” probe. Likewise, with headings included, lowercase “results” gives the best heading 0.54 at rank four; 0.64 at rank two is title case. The plan currently attributes those stronger numbers to the linked lowercase query, concealing a potentially relevant casing effect.

Separate the two query variants throughout the reproduction and heading discussion, and describe the reported quick sequence as inferred rather than reproduced—the surviving production row is thorough.

The client audit found no 70-floor dependency: its default threshold is 30 ([search-hits.ts:1151](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/src/web/search-hits.ts:1151)), filtering is generic, and rendering accepts the full 0–100 range ([SearchPanel.tsx:2052](/home/greg/code/spideryarn2/.claude/worktrees/fbjp5nxn-quick-search-finds-too-little/src/web/SearchPanel.tsx:2052)).

**Verdict: not ready to build; Stage A needs fair relevance labels, hard negatives, comparable arms, and cap/stability measurements before it can choose a fallback rule.**