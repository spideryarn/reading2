Verdict: **NOT RUN YET.** Phase 2 is worth running, but only after a small preflight revision. As designed, it can spend money and produce precise-looking numbers that neither establish semantic quality nor preserve enough evidence to audit the result later.

I read the committed `a5305a5` implementation, all 21 scorer tests, the production ToC call, research, prior review, and committed result. I made no edits. Some dedupe changes appeared concurrently while I reviewed; I checked those too and distinguish them below.

## Findings

1. **The scorer is a good diagnostic panel, but not a quality evaluation. Agree with the code’s own warning; disagree with using its numbers to choose a winner without human judgment.**  
   **Code-read:** `score.ts` explicitly says none of the measures decides whether a tree is good ([score.ts:1](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/score.ts:1)). The implementation confirms that all outputs are mechanical properties.  
   **Inference:** Several can be improved by a worse arm:

   | Measure | What it really measures | How a worse arm wins |
   |---|---|---|
   | Validity | Schema, tiling, ranges | Produce a valid but meaningless hierarchy |
   | Balance CV | Equal-sized L1 ranges | Cut mechanically by word count across arguments |
   | Depth uniformity | Consistent UI depth | Add arbitrary levels everywhere |
   | Heading agreement | Fidelity to source markup | Copy bad/furniture headings |
   | Fanout 5–9 | Prompt-shape compliance | Make arbitrary groups of seven |
   | 2–6-word titles | Surface brevity | Emit generic labels such as “Central Argument” |
   | Vocabulary retention | Lexical extractiveness | Copy source words without capturing the claim |
   | Gist coverage | Non-empty strings | Fill every node with fluent rubbish |
   | Opening bigram | First-two-word variety | Rotate openings while repeating the same template afterwards |

   Retention is one-sided—output words found anywhere in the range—not completeness, fidelity, or distinctiveness ([score.ts:48–53](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/score.ts:48)). Title compliance also scores copied author headings against 2–6 words, even though the production prompt says to preserve them unchanged ([hierarchy.ts:99–105](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:99)).

   **Change:** Keep these as diagnostics and hard guards. Add a blinded human primary outcome over sampled trees: boundary usefulness, missed/spurious cuts, hierarchy coherence, navigational title quality, and gist faithfulness. The result may say an arm wins only when that judgment and the mechanical guards agree.

2. **One heading statistic currently credits a boundary nobody chose.**  
   **Code-read:** `allStarts` includes the root; `headingsCut` therefore counts a heading at block zero automatically. `l1OnHeadings` also includes the forced first L1 start, unlike `compareTrees`, which excludes index zero ([score.ts:260](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/score.ts:260), [score.ts:405](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/score.ts:405)). The current result demonstrates it: `writes` reports `headingsCut: 1` and `l1OnHeadings: .25` even though every optional boundary is off-heading ([result:935](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/results/hierarchy-structure-headings+incumbent-disk-2026-08-30-08-03-48.json:935)).

   **Change:** Exclude article index zero from both numerator and denominator wherever the measure claims to describe a chosen boundary. Call a heading at zero unobservable, not successfully cut. Add a regression test.

3. **Arm zero is a valid denominator only for recoverable geometry, not for overall ToC quality.**  
   **Code-read:** It deliberately has no gists and cannot introduce topic boundaries between headings ([heading-tree.ts:12–20](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/heading-tree.ts:12)). Its trees therefore fail the production validity contract’s gist rule ([tree-invariants.ts:257](/Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:257)).  
   **Inference:** The honest claim is:

   > On 4 of 7 current real documents, this tuned heading heuristic and one historical incumbent run chose the same L1 cut points. That does not show equal usefulness or correctness. It shows that those top-level cuts were available without a model; the model’s measurable additions are deeper semantic cuts, gists, and generated titles.

   Gist measures for arm zero should be **N/A**, not zero. Likewise, “structurally sound” should mean “ranges and tiling are sound, but not publish-valid.”

   There is also a concrete silent-success bug: the runner describes missing gists as “expected for the free arm” without checking which arm produced them, and says any gistless result is from an arm that cannot write gists ([run.ts:135–184](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/run.ts:135)). A paid arm could therefore omit gists and receive reassuring console prose.

   **Change:** Make validity interpretation arm-aware. Missing gists are expected only for `headings`; they invalidate every paid arm. Prefer typed `checkTree` issue codes over classifying errors by substring ([score.ts:213](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/score.ts:213)).

4. **The heading rule is fitted to this corpus—especially the 20-word threshold.**  
   **Code-read:** The comment says 20 was selected because it lies between this corpus’s largest observed stub and smallest observed real section ([heading-tree.ts:79–85](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/heading-tree.ts:79)). Its motivating examples are the constitution and `scaling-hypothesis`, and the tests encode those same cases ([heading-tree.ts:36–49](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/heading-tree.ts:36), [test:417](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/hierarchy-structure-eval.test.ts:417)). The ≥3 rule has a defensible prior—“three is a series”—but was also selected after observing `fowler`.

   The merge fixes part counts, not necessarily labels: the merged constitution title stub remains titled by the first heading in the merged range, which can be the document title rather than the following section heading ([heading-tree.ts:194–215](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/heading-tree.ts:194)).

   **Change:** Freeze these seven as the development set. Evaluate the unchanged rule on held-out documents, and report sensitivity at 0/10/20/40 words. Do not retune after seeing the held-out results.

5. **The corpus is not yet an explicit seven-document corpus. Expand and lock it before paid comparison.**  
   **Code-read:** `a5305a5`’s committed result had 10 slugs per arm: three copies of “Forms of Memory” plus `example`. The concurrent change now drops two duplicate directories, but still discovers every future `data/` directory automatically and appends `example` ([run.ts:67–93](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/run.ts:67)). The regenerated result therefore contains eight items, not seven; `example` remains at [result:965](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/results/hierarchy-structure-headings+incumbent-disk-2026-08-30-08-03-48.json:965).

   **Change:** Replace discovery with a committed corpus manifest containing canonical slug, duplicate group, input hash, and selection reason. Exclude `example` from claims about real documents.

   Add about **five held-out documents**, selected before running the heuristic:

   - long prose with zero or one useful heading;
   - sparse headings and long unheaded runs;
   - dense or furniture-heavy headings;
   - a genuinely deep h1–h5/book extract;
   - a non-essay form such as news or an academic paper.

   Twelve distinct documents is still small, but enough to expose obvious corpus memorisation. Screen expensive arms on a stratified subset, then run only finalists over the full set.

6. **Two incumbent runs plus a third on two documents is orientation, not an established noise floor.**  
   **Code-read:** `incumbent-repeat` is merely an identical recipe ([arms.ts:63–67](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/arms.ts:63)). `compareTrees` uses exact-boundary Jaccard ([score.ts:386–430](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/score.ts:386)). A boundary moving one block counts as completely different, while different nesting arrangements sharing the same start indices can look identical.  
   **Inference:** The difference between two incumbent outputs measures incumbent stochasticity under this exact configuration—not “the resolution of the whole instrument.” Challenger arms may have different variance. Three outputs technically permit a sample variance, but it will be extremely unstable.

   **Cheapest adequate design:** use three stratified calibration documents—long/well-headed, long/unheaded, and short—and run the incumbent four times on each. That is 12 calls, fewer than the proposed 16 incumbent calls. Report per-document ranges/MADs, not one pooled threshold. Screen all arms once on those documents, then repeat only the leading two recipes. Interleave and persist call order.

   Keep exact Jaccard, but add a tolerant boundary-distance measure and a level-sensitive comparison. Otherwise harmless one-block movement dominates the claimed floor.

7. **A separately implemented executor can easily stop evaluating the production stage. This is a blocker until parity is designed.**  
   **Code-read:** Production does much more than send model+effort:

   - body/supplement splitting and withholding ([hierarchy.ts:679–691](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:679));
   - a measured output budget plus 40k thinking headroom;
   - adaptive thinking and `output_config.effort`;
   - the exact private system prompt and block rendering;
   - OpenRouter’s Messages skin with Anthropic upstream preference and `require_parameters` ([messages-stream.ts:70–94](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages-stream.ts:70));
   - refusal/truncation handling, JSON parsing, `buildTree`, and supplement append ([hierarchy.ts:705–760](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:705)).

   Yet `CallSpec` records only `model` and `effort` ([arms.ts:30–35](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/arms.ts:30)).

   **Inference:** Likely drift points are prompt bytes/order, body filtering, provider pinning, adaptive thinking versus `reasoning.effort`, `max_tokens` versus `max_completion_tokens`, model-specific ceilings, response parsing, truncation detection, retries, and generator stamps.

   **Change:** Extract shared production functions for prompt construction, block rendering, budgeting, parsing, tree construction, and validation. Add a parity test asserting that the incumbent eval request is byte-for-byte/policy-for-policy equivalent to production. Implement only the transport adapter separately for chat/completions, and save the fully resolved policy in the result. If the cheap arm wins, the eventual pipeline implementation must use that same adapter before the result is treated as deployable evidence.

8. **The arms are useful policy recipes, but several cannot support causal claims.**  
   **Code-read and inference:**

   - `smart-low` cleanly isolates effort from the incumbent, subject to stochastic noise.
   - `cheap-high` combines model, wire, upstream reasoning semantics, and probably budget behavior. This is acknowledged ([arms.ts:13–17](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/arms.ts:13)). It may choose a deployable recipe, but cannot explain why it won.
   - `headings-seeded` tests supplying an entire deterministic proposed tree—not merely making author headings explicit. Production already includes heading blocks and calls them hard boundaries ([hierarchy.ts:81–105](/Users/greg/Dropbox/dev/experim/spideryarn2/src/hierarchy.ts:81)). Add a separate explicit-heading-list arm if salience is the question.
   - `waves` declares only L1 then L2 ([arms.ts:53–54](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/arms.ts:53)). It does not test the stated L1→L2→L3 process or the book-length, more-than-three-level motivation.
   - `cheap-then-revise` varies model, wire, prompt role, and call count. Judge it as one end-to-end strategy, including both calls’ latency and cost.

   **Change:** Label results as either “isolated comparison” or “strategy bake-off.” Do not build an expensive full factorial. Add only the explicit-heading arm and make waves exercise at least three levels on a deep held-out document.

9. **The results artifact would be misleading and fragile three months later.**  
   **Code-read:** `ArmResult` retains scores but not the generated tree, raw response, request policy, usage, cost, latency, run index, or input hash ([run.ts:34–52](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/run.ts:34)). It writes once, after every article and arm finish ([run.ts:223–252](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/hierarchy-structure/run.ts:223)). A failure after paid calls therefore leaves the spend ledger but no eval artifact and no raw trees to judge.

   The surrounding prose is already drifting:

   - `evals/README.md` and `run.ts` still say roughly 70%, while the corrected research says 88% ([README:189–195](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/README.md:189), [research:317–331](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/research/260830a-opening-an-article-before-the-toc.md:317)).
   - The corrected research says 4/7, but later sections still say 6/9 and 8/10 ([research:514–532](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/research/260830a-opening-an-article-before-the-toc.md:514), [research:554–560](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/research/260830a-opening-an-article-before-the-toc.md:554)).

   **Change:** Checkpoint after every call. Preserve raw/generated trees and a manifest containing commit, scorer version, prompt hashes, corpus hashes, resolved arm policy, actual responding model/provider, call order, latency, token/cost fields, errors, and linkage to spend rows. Put the human judgments beside those artifacts.

## Minimum gate before spending

1. Lock a real corpus manifest, exclude `example`, and add five held-out structural cases.
2. Fix the forced-start heading statistic and arm-aware gist validity.
3. Add the blinded semantic rubric and declare it the primary outcome.
4. Build the executor from shared production request/parsing code with an incumbent parity test.
5. Persist raw trees, policy/provenance, usage, and incremental checkpoints.
6. Use the staged calibration/screen/finalist design rather than running every recipe across everything immediately.

After those changes: **run phase 2**, first on the small calibration panel, then expand only the contenders.

Verification note: I attempted the focused Vitest file, but the read-only sandbox prevented Vitest from creating `node_modules/.vite-temp`; this was an environment `EPERM`, not a test failure.