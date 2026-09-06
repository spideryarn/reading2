# The nine GPT Sol reviews of stage B

Companion to [260904e-extraction-repair-evals-and-llm-post-processing.md](260904e-extraction-repair-evals-and-llm-post-processing.md).
Every one of the nine returned **FIX FIRST**, and every one found a defect that
changed the code. They are kept whole because § B records what came of each
finding but not how it was reproduced, and the reproductions are the part a
future reader cannot regenerate.

**The pattern is the point.** Eight of the nine found the same shape of fault by
the same method: construct a degraded extraction and see whether the scorecard
notices. Each one that scored well did so for a different reason — a collage of
the assertion file's own needles; a collage of genuine off-article elements;
deleted generated nodes; unbounded padding; one node repeated 197 times;
generated nodes reversed; reordering across source ids; a silently dropped run.
The ninth is the first whose direction is reversed: a *correct* extraction
condemned.

As the agent that built it put it, unprompted:

> Sol's cases are the only ones written by somebody trying to break it rather
> than trying to fix it.

That is the argument for the **shape corpus** recorded in § B, and the reason
these nine are worth keeping.



---

## Review 1

## Verdict: FIX FIRST

The central question has a decisive answer: **yes, this scorecard can be fooled while badly damaging an article.** The underlying scorecard/manifests split is salvageable, but the current article-level labels and “hard gates” are not trustworthy enough to govern Stage C.

### Findings, ranked by impact

1. **The manifest tier can call a near-total deletion acceptable.** `[reproduced — large design change]`

   I constructed a `needle-collage` arm for `aaronson`: it returns only the three `mustContain` strings, all copied from the source.

   - Shipped extraction: 32,918 characters
   - Adversarial arm: 182 characters, **0.55% retained**
   - `assertionsPassed: true`
   - Every exercised metric: `1.0`
   - Attribution: pass
   - Source order: pass
   - `detects(shipped, arm)`: false

   The same tier also misses duplication: duplicating a long paragraph on the conformance page left every manifest metric and both gates green.

   This becomes worse because [`labelFor`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:105) converts that sparse evidence into the whole-article label `acceptable`, and [`--record`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:176) writes it into the manifest.

   Those labels are also **not blinded judgements**, as § B promises. They are derived automatically from the ruler they were meant to audit. This is circular.

   Fix: manifest-tier output must say only what it knows—e.g. “declared assertions unchanged”—unless supplemented by independent human labels or meaningful coverage gold. Add the needle-collage and duplicate-paragraph arms as required failures.

2. **The “hard gates” are neither reliable nor hard.** `[reproduced — large change]`

   [`gatesFor`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:494) ignores every block below 60 characters. Consequently, the synthetic navigation corruption adds 393 characters of invented text across 30 short blocks and attribution still passes unchanged.

   Source order uses `source.indexOf()` independently for each block. A duplicated paragraph receives the same source position twice, is deemed non-decreasing, and passes.

   Worse, the full run showed attribution already failing on 8 of 12 shipped outputs. Yet shipped output is labelled acceptable whenever manifest assertions pass, because [`labelFor` ignores both gates](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:105). For comparisons, a gate already false cannot notice additional damage either.

   The strong provenance form is not wholly out of reach: the present deterministic arms can be run from stamped source DOMs now. Model-specific provenance may wait, but the current arms and an invented-short-text corruption should not.

3. **Several gold/manifest assertions flatter the current pipeline.** `[reproduced — medium change]`

   - [`wiki-gdp-table`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/fixtures/wiki-gdp-table.manifest.json:10) calls `"United States"` a `numeric-cell`. It is neither numeric nor table-specific. The shipped extraction passes it through an ordinary narrative paragraph while destroying the GDP table.
   - [`ar5iv-attention`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/fixtures/ar5iv-attention.manifest.json:35) declares floors of 7 tables and 110 math nodes. The source has 9 tables and 142 math nodes; shipped output has exactly 7 and 116. I confirmed the two missing tables are substantive results/complexity tables. Nevertheless, structure scores `1.00`.
   - [`shakespeare-hamlet`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/fixtures/shakespeare-hamlet.manifest.json:30) requires 12,000 gistable characters, while the entire source has only about 10,179 normalized text characters. The manifest is impossible to satisfy.
   - [`CONFORMANCE_GOLD`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/conformance-page.mts:99) says `whole-document` but omits legitimate headings, table text, code and figure text. The clean page’s `bodyPurity` is only `0.931`; deleting omitted legitimate material can therefore improve purity.

   The Wikipedia and Quanta manifests do genuinely fail in the runner, and the runner prints those failures explicitly. It does, however, exit successfully because it is a report rather than a gate. Seven shipped manifests currently fail, not only those two.

   I also confirmed the important Stage C fact: raw body preserves all 8 GDP-page tables while shipped extraction retains 1.

4. **The polarity evidence is only partly real.** `[reproduced/reasoned — medium change]`

   Confirmed:

   - The old `offending / totalBlocks` form rises when clean navigation is added: in my reproduction, `0.875 → 0.974`. The fixed-budget form stays `0.975 → 0.975`.
   - Without the stranded pilcrow, the old ratio would indeed be vacuous because its numerator is zero.
   - The current pilcrow makes that mutation test capable of going red.

   Not confirmed as an executable guarantee:

   - The test named “REFUSES a recovery-only card” never calls `polarityPair` with the recovery-only scorer. It merely verifies that the remaining metrics are flat ([test body](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-scorer.test.ts:187)). `polarityPair` could stop refusing that card and this test would remain green.
   - The claimed 1,000 characters of navigation are actually **393 normalized text characters**. The test gets over 1,000 by counting HTML markup ([assertions](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-scorer.test.ts:148)), although `bodyPurity` measures text.
   - Passing requires only one metric to rise and one to fall. Metadata is never perturbed; gates are omitted; several metrics therefore have no individual polarity proof.

5. **Manifest validation still silently accepts typoed keys.** `[reproduced — small/medium change]`

   Despite [`parseManifest`’s stated purpose](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/manifest.mts:188), all of these parse successfully and assert less than their author intended:

   - `mustContian`
   - `maxBlockChar`
   - needle field `negativeContorl`

   Unknown keys need rejection recursively, and numeric floors should be finite non-negative integers with consistent bounds.

6. **The tag-strip integrity check is corpus-compatible, not parser-correct.** `[reproduced — medium change]`

   Ordinary scripts and nested inline markup agreed with JSDOM. I found disagreements for:

   - unlisted entities such as `&trade;` and `&frac12;`
   - semicolonless entities
   - CDATA
   - raw-text elements such as `<textarea>`
   - `>` inside quoted attributes
   - script end-tag edge cases

   The quoted “66 needles, 0 disagreements” is honest evidence about today’s corpus, but not evidence that the implementation is equivalent. In particular, `<p title="x > Privacy policy">…` can leak attribute fragments into the supposed visible text. The regex at [`textOfFixture`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-manifests.test.ts:102) should be replaced by a real, cheaper HTML parser or kept only with explicit adversarial equivalence tests.

7. **The five arms and negative controls work as narrowly claimed.** `[reproduced]`

   All five arms lost somewhere on a named metric/gate. The short-block arm specifically lost:

   - `1–0`
   - `23.6`
   - `21.0`
   - `❦`

   The shipped arm kept all four. The synthetic page is fair as a counterexample to the exact ≤6-character rule, provided it remains described as conformance rather than prevalence evidence.

   `article-plus-rail` does use source-page elements rather than invented text. But `nav/header/footer` does not prove “chrome,” and the assertion that invented content is inherently undetectable is only true because the attribution gate currently ignores its short blocks.

8. **The floor-mask patch fixes its historical case, but the recorded account is stale and the class remains.** `[reproduced/reasoned]`

   The `base===0 && candidate===0` check correctly prevents `improved` in the described old case. In the current manifest, however, shipped Wikipedia exclusion is `0.67`, not `0.00`; raw body is `0.00`. The current run therefore no longer reproduces the explanation in [`labelFor`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:113).

   False hard gates have the same floor-masking problem but are not included. Discrete structure floors also hide additional damage once already failed. Removing automatic whole-article labels is safer than accumulating masking exceptions.

9. **WCXB is useful but not yet independently reproducible here.** `[partly reproduced/reasoned]`

   The committed selection contains 200 unique IDs and URLs, and their SHA-256 ranks are monotonically ordered by the recorded seed. The selection algorithm is deterministic for a fixed record set.

   The archive is absent locally, so I could not prove these are the top 200 eligible test records or independently reproduce the zero-overlap claim. There is also no WCXB test. `selectedOn` makes the full output date-dependent, and `selectHoldout` merely labels `opts.split`; only the CLI ensures the supplied records came from that split.

   The official repository confirms 2,008 pages, 511 test records, 257 test articles, nested ground truth, Readability’s 0.675 dev F1, CC-BY-4.0, and says the Claude draft received four independent human review passes. It currently calls the dataset WCXB, so the WCEB wording should be tied specifically to whichever archived metadata used it. [Official WCXB repository](https://github.com/Murrough-Foley/web-content-extraction-benchmark)

   Claude-assisted gold is **not disqualifying**, but it cannot be the sole acceptance oracle for a future Claude repair pass. Keep it aggregate-only, combine it with independently human-adjudicated examples, and have non-Claude/human review inspect a blinded sample of disagreements.

10. **Two of the three deferrals are too broad.** `[reasoned]`

   - Wrong folding genuinely requires Stage D semantics.
   - Strong attribution for a future model operation may wait, but strong provenance for today’s deterministic arms and a corruption that invents short text can be tested now.
   - Bot-wall response policy can wait; **scoring “this is not an article” cannot**. A candidate/result union can represent refusal separately from deciding whether production rejects, retries or warns. The worst observed silent-success state belongs in the Stage B ruler.

### Checks run

- Stage B tests: **30/30 passed**
- Full score run: completed; 8/12 fixture polarity pairs established, 4 explicitly unestablished
- Typecheck: passed for all projects
- `git diff --check`: passed
- Full `npm test`: not usable as a final signal in this sandbox; local Postgres and subprocess IPC were blocked, causing many unrelated suites to fail or time out, so I stopped it
- Workspace files changed by me: none

The right repair is not “add one more metric.” First separate sparse assertions from independent article-quality judgement; then make provenance/order gates genuinely decisive; then correct the manifests and make the red-first controls executable.


---

## Review 2

## Verdict: FIX FIRST

The headline claim does **not** hold. I reproduced an arm that deletes **99.458% of the actual article**, passes every exercised metric and both provenance gates, satisfies every manifest assertion, and records no regression.

### Findings, ranked by impact

1. **A provenance-clean arm can still delete 99.45% of the article.** `[reproduced]`

   On `aaronson`, I built an arm entirely from genuine stamped source elements:

   - Kept the three required post passages, trimmed to their exact source-supported text.
   - Kept the five genuine stamped figures/images.
   - Used two genuine comment-thread blockquotes to satisfy the blockquote floor.
   - Filled `minArticleChars: 30000` with later stamped comment paragraphs, avoiding the three named exclusions.

   Result:

   - Shipped article: **32,820** gistable characters.
   - Genuine post text retained: **178 characters, 0.542%**.
   - Genuine post text deleted: **99.458%**.
   - Output length: **30,052 characters**, almost entirely comments.
   - Every exercised metric: **1.00**.
   - `assertionsPassed: true`.
   - Attribution: pass, 91 nodes.
   - Source order: pass, 91 nodes.
   - `detects(shipped, adversary)`: **false**.

   Provenance proves only that text came from somewhere on the page. It cannot distinguish the article from its 52,776-word comment thread. The length floor likewise counts all gistable output, not article-source content ([scorecard.mts:527](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:527)).

   The existing stamped-collage test keeps only needles on the small negative-control page and therefore fails its structure floor ([extraction-scorer.test.ts:825](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-scorer.test.ts:825)). It does not exercise padding with provenance-clean non-article source content.

2. **Content can be reordered inside a stamped element without either gate noticing.** `[reproduced]`

   On `negative-controls`, I took one directly stamped, leaf-level 459-character paragraph and swapped its two 231/227-character halves.

   The result passed every assertion, every metric and both gates, with no detected regression.

   `coverOf` searches for each run anywhere in the source element; it does not advance a source-side cursor ([scorecard.mts:732](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:732)). Consequently, total output coverage does not mean the output is a source-order subsequence.

   So `MIN_RUN` and `MIN_RUN_IN_ELEMENT` are not percentage-damage tolerances, but they participate in a real compositional tolerance: arbitrarily reordered source runs can still form a total cover. The current reverse-every-word test catches one conspicuous rewrite, not this class.

   For adjacent stamps:

   - Two distinct adjacent ids swapped are caught through `at < previous`.
   - Two adjacent outputs sharing one stamp are **not** caught. I split a source element into two stamped halves and emitted right-before-left; both gates passed. Equal stamp positions are permitted, and duplication rejects only an identical `(id, text)` pair ([scorecard.mts:943](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:943)).

3. **Own-text coverage leaves parent/child semantics and symbol-only invention invisible.** `[reproduced]`

   The implementation is no longer leaves-only: it examines every element’s direct text nodes ([scorecard.mts:81](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:81)). That correctly closes the Hamlet omission.

   It does not, however, inspect structural relationships. I moved the last cell of one table row to the start of the next. Global leaf order remained identical, but the datum became associated with the wrong row. Row widths changed from the intended shape to `3, 5, 4, 4, 4`; every metric, assertion and gate still passed.

   There is also a smaller literal contradiction to the attribution contract: appending a fabricated unstamped `<p>☠☠☠</p>` passed everything. `HAS_CONTENT` ignores elements without a letter or digit ([scorecard.mts:685](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:685)), even though the gate says nothing in the output may be text the page did not have.

4. **The “every arm loses on every exercised fixture” claim is tested over only three fixtures and is false over fourteen.** `[reproduced]`

   The supposedly per-fixture test uses only `negative-controls`, `arxiv-abs` and `shakespeare-hamlet` ([extraction-scorer.test.ts:558](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-scorer.test.ts:558)).

   The full run produced multiple exercised-but-flat arms. The clearest is `drop-every-short-block` on `ar5iv-attention`:

   - Removed **1,072 leaf elements** and **1,393 gistable characters**.
   - Shipped: 33,859 characters; arm: 32,466.
   - `detects`: no metric and no gate.
   - The already-failed math/table floors remain at the same score, illustrating that floor masking still exists in comparisons even though the old whole-article label was removed.

   `aaronson`’s exercised `first-20-percent` and short-block arms also reported no regression. Therefore § B’s claim at [the plan:867](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:867) must either be narrowed to the three test fixtures or actually enforced over all fourteen.

5. **Label removal is clean, but `findings.gatesPassed` overstates partial gate exercise.** `[reasoned]`

   I found no live downstream reader of the deleted extraction `labels`; remaining mentions are historical documentation. All fourteen manifests have neither `labels` nor recorded `findings` currently, and `--record` now writes the new shape.

   One new field does not mean what its type says. `ArmFinding.gatesPassed` is documented as “Both hard gates passed” ([manifest.mts:130](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/manifest.mts:130)), but `findingFor` discards abstentions and returns true if every remaining gate passes ([score.mts:121](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:121)).

   The full run showed `pmc-article` as attribution `ok`, source order `—`. Recording it would nevertheless write `gatesPassed: true`. This also makes § B’s “both gates pass on all fourteen” false: thirteen pass both; PMC’s order gate abstains.

### Checks that held

- The four questioned floor derivations are honest:

  - MDN has nine source `<h2>`: seven article headings plus “In this article” and “Help improve MDN”. The manifest is now the stronger `exactly: 7`, not merely ≥7. Source/shipped tables are 3/2.
  - Constitution has 33 source `<h3>`: 24 article subsections and nine footer columns. Shipped retains 24.
  - Wikipedia has eight source tables: three conservatively asserted article tables, one map wrapper and four navboxes. Shipped retains one.
  - Python docs has 29/29 source/shipped `<pre>` and 3/3 tables.

- `HARMLESS_HERE` itself is honest. I independently listed exactly `[v1]` through `[v7]`; all are submission-history links, not abstract content. It is not presently a tolerance table. The problem is that the surrounding assertion covers only three fixtures while the plan describes all fourteen.

- Strict manifest-key validation, `notAnArticle`, the whole-document conformance gold, the visible-text adversarial table and WCXB’s internally checkable properties all passed without a new blocker.

### Still-false statements in § B

The substantive false claims are:

- “The gates are decisive.”
- A real stamped collage is caught by structure and `minArticleChars`.
- Rewritten prose inside a stamped node is generally caught.
- Every degenerate arm loses on every exercised fixture.
- Both gates pass on all fourteen shipped extractions.

The reported 8/14 polarity result, 11 failing versus three passing shipped manifests, and the four corrected floor accounts do reproduce.

### Checks run

- Extraction suites: **131/131 passed**.
- Full fourteen-fixture score run: completed successfully.
- Typecheck: all projects passed via `node --import tsx scripts/typecheck.ts`.
- Reproduction scripts: [stage-b-adversary.mts](/tmp/stage-b-adversary.mts), [stage-b-short-arm.mts](/tmp/stage-b-short-arm.mts), [stage-b-floor-audit.mts](/tmp/stage-b-floor-audit.mts).
- Repository files changed by me: none.


---

## Review 3

## Verdict: FIX FIRST

A badly degraded extraction can still score well in three distinct ways. I reproduced all three. The design is salvageable, so I would not back it out, but its central measurement claim is not ready for trunk.

### Findings, largest code change first

1. **Large — generated-node deletion is invisible to `articleRecall`** — reproduced

[`articleReturned`](</home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:483>) credits only directly stamped nodes. On `pg-greatwork`, Readability-generated nodes contain most of the output:

- Shipped gistable output: 66,449 characters.
- Removing generated leaf nodes deleted 44,408 characters.
- Remaining gistable output: 12,665 characters—about 81% gone.
- `articleChars` and `articleRecall` remained exactly unchanged: 6,330 and 0.1153.
- Attribution and source-order gates still passed.
- No regression was detected.

This disproves the claim that ignoring generated nodes is safe merely because floors come from a measured run. A measured floor cannot detect deletion of text that the numerator never credited.

Fix: make region recall cover generated output too—probably through order-aware region text coverage—or otherwise map generated nodes back to their source text. Add a generated-heavy fixture/arm that deletes generated nodes and must lose.

2. **Large — unlimited off-article padding is not detected** — reproduced

The plan says padding is caught by the article/output pair, but that pair is only reported. It is not a metric consumed by [`detects`](</home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1578>).

I constructed an Aaronson extraction containing the complete article plus 671 genuine, correctly ordered, stamped comment paragraphs:

- Shipped output: 32,820 characters.
- Padded output: 313,145 characters.
- All assertions passed.
- Attribution and source-order gates passed over 936 nodes.
- `articleRecall` was slightly better than shipped.
- `detects` reported no regression.

This is almost ten times the correct output, mostly comments, and still scores well.

Fix: add an enforced region-precision/body-purity metric in compatible units, then add a “complete article plus off-region source content” degraded arm. Merely printing `articleChars` beside `gistableChars` is not a defence.

3. **Medium — short-run forgiveness composes into large-scale corruption** — reproduced

[`coverOf`](</home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1032>) forgives every unmatched run shorter than `minRun` when that run appears somewhere in the source. There is no total corruption budget.

On `negative-controls`, I repeatedly emitted eight correct ordered characters followed by seven displaced source characters:

- 2,829 characters attacked.
- 42.1% of attacked positions changed.
- 31.6% of the entire article changed.
- The result is visibly garbled.
- Every exercised metric scored 1.00.
- `articleRecall` was 1.00.
- Both gates passed; `detects` found nothing.

The source-side cursor fixed the half-swap, but the replacement account remains too strong: “up to 7/23 per join” can be repeated without limit.

Fix: for direct stamps, require exact ordered source substrings, or globally bound forgiven characters and credit only actually covered text. Add this repeated 8-good/7-displaced case as a red test.

4. **Medium/small — three article regions include content their manifests forbid** — reproduced

The declared regions contain their own `mustNotContain` furniture:

- [`ar5iv-attention.manifest.json`](</home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/fixtures/ar5iv-attention.manifest.json:25>): licence text inside `article.ltx_document`.
- [`aaronson.manifest.json`](</home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/fixtures/aaronson.manifest.json:20>): WordPress posting metadata inside `div.entry`.
- [`plos-biology.manifest.json`](</home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/fixtures/plos-biology.manifest.json:15>): repeated “View Article” and “PubMed/NCBI” furniture inside `div#artText`.

Removing known junk therefore improves exclusion precision while lowering article recall. That is not conservative; the metrics disagree about what “article” means.

Fix the regions with `except`, rederive their totals/floors, and add an integrity check that forbidden strings are not inside the credited region.

I found no prepared-document movement problem elsewhere. The Wikipedia notes moved by `prepareDocument` remain within its declared region.

5. **Small — the checked-in result artifact is stale** — reproduced

[`extraction-score.json`](</home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/results/extraction-score.json:1>) has the old schema and arm set:

- No `articleRecall`.
- Old `gatesPassed` field rather than the current gate record.
- Missing `region-padded-collage`.
- 125 rows, corresponding to the previous eight-arm run.

Regenerate it and preferably validate that results cover the current fixture/arm matrix and schema.

6. **Small — partial-run exemption checking is incorrectly global** — reproduced

Your proposed fix is right. [`score.mts`](</home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:365>) checks all exemptions against the current run’s exercised pairs, so `--fixture aaronson` fails over an unselected `arxiv-abs` exemption.

Scope stale-exemption checks to fixtures included in the invocation. An exemption belonging to a selected fixture should still fail if it was not exercised or is no longer harmless.

### Judgement on the stated limits

- **Table-row semantics:** acceptable as a documented Stage B limitation. It is materially narrower than the failures above.
- **Addition without deletion:** blocker. The code currently reports evidence but does not score or enforce it.
- **Over-generous regions:** blocker where already demonstrated. Three manifests presently credit known non-article content.
- **Needle collage:** fair control, not rigged. Supplying its own unstamped output lets the provenance mechanism inspect it and correctly conclude that nothing has source provenance.
- **Bot-wall narrowing:** honest. There is no article for an article-damaging arm to damage.
- **Aaronson `first-20-percent` exemption:** currently justified and mechanically checked; it does not yet look like a tolerance table.

The region arithmetic matched the documented measurements across all twelve region-bearing pages, and I found no floor simply copied from the current score. The problem is what some regions and numerators count, not the arithmetic.

### Verification

- Extraction tests: **4 files, 146 tests passed**.
- Full score run: **exit 0**.
- `--fixture aaronson`: **exit 1**, reproducing the stale-exemption bug.
- Typecheck: all **1,313 source files covered and passed** via the direct runner; the npm wrapper hit a sandbox IPC permission error.
- `git diff --check`: passed.
- No repository files were changed.


---

## Review 4

## Verdict: FIX FIRST

A badly degraded extraction can still score well. The generated-node repair introduces a new overlap-crediting hole that defeats every metric, both gates, and every assertion.

### Findings, largest code change first

1. **Medium/large — repeated generated text is credited as distinct article coverage** — reproduced

[`articleReturned()`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:613) adds each node’s `cover.covered` to its ancestor’s credit, capped only at the ancestor’s total length. It does not track which source intervals were covered. Meanwhile generated nodes are excluded from duplicate and order accounting in [`provenanceForm()`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1453).

On `pg-greatwork` I returned:

- 197 copies of one genuine generated paragraph.
- The three required strings.
- The required image.
- Two small direct-stamp witnesses so both gates were exercised and passed.
- 200 paragraphs total, satisfying the source-derived floor.

Results:

- Only **4 distinct paragraphs / 503 whitespace-free characters**, at most **0.92%** of the 54,900-character region.
- 69,020 gistable output characters, overwhelmingly repetition.
- `articleRecall`: **0.9881**
- `regionPrecision`: **0.9760**
- `requiredRecall`, structure, and cleanliness: **1.00**
- Attribution: **pass**, 202 nodes.
- Source order: **pass**, 2 nodes.
- `assertionsPassed`: **true**
- `detects(shipped, candidate)`: **false**
- The diagnostic basis admits only **3 of 108** region elements returned.

The cap at [`credited.set(...)`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:680) prevents scores above 1.00, but it does not prevent the same 281 source characters being counted 197 times.

Fix by making `coverOf` return source intervals and crediting the union of non-overlapping intervals per source id. Generated-node duplication/overlap should also fail a gate or otherwise be recorded as damage. Add this arm permanently.

Consequently, the reported 91.4%/99.6% ancestor match rates may describe individual nodes, and the shipped `pg-greatwork` score of 0.9242 reproduces, but the result is not a conservative bounded under-count: overlapping matches can produce a severe over-count.

2. **Small — `forbiddenInsideRegion()` is not general enough** — reproduced

[`forbiddenInsideRegion()`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:570) joins each element’s own text with NUL. It therefore misses forbidden text spanning elements.

A synthetic region containing `<span>Bad</span><span>Stuff</span>` with `mustNotContain: "BadStuff"` produced:

- `forbiddenInsideRegion(...)`: `[]`
- `exclusionPrecision`: `0`
- `articleRecall`: `1`

The comment claiming `articleReturned` could not pay for such text is incorrect: it credits both component elements. The current fifteen-fixture audit is clean, but the general guarantee is false. Reconstruct the selected region’s combined visible text after applying `except`, and add a cross-inline-boundary test.

3. **Small — evidence counts and artifact validation are stale/one-sided** — reproduced/reasoned

The result artifact itself is current: **165 unique fixture/arm rows plus 13 conformance rows = 178**, with no duplicates. That is 15 fixtures × **11 total arms**: ten degenerate arms plus shipped. However:

- [`score.mts`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:12) says ten total arms.
- [`arms.mts`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/arms.mts:1) and [`evals/README.md`](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/README.md:65) still say eight degenerate arms.
- The artifact test checks for missing pairs but not extras or duplicates, checks metric schema on only five rows, and checks missing corruption names but not stale extras.

Similarly, using every row enumerated by the floor-evidence script, the three padding-shaped arms have **21 exercised region-precision rows: 17 clear 0.50 and 4 fail**, not 8 of 12. The narrower numerical claim does hold: among those padding rows nothing lies between 0.2464 and 0.6401; the next value is 0.6456. No shipped extraction fails the 0.50 floor.

I consider 0.50 defensible as a semantic “most output is article” emergency backstop, but not as a separator between good and padded outputs. Also, `arxiv-abs` is the worst **shipped baseline**, not a correct extraction—it already fails its manifest for retained furniture.

### Other requested checks

- **Short-run forgiveness:** verified. Fixed 8-good/7-displaced is rejected even by the old unbudgeted algorithm. The old oracle-guided attacks still insert 445–728 characters but are caught; a budget-aware oracle gets only 36–63 through the gate, and `regionPrecision` detects every case.
- **Region `except` fixes:** the three known cases are clean in the full corpus run, but finding 2 limits the general claim.
- **Partial invocation:** `--fixture aaronson` exited 0.
- **Text-cursor rejection:** correct for a single irreversible document-order cursor. PLOS’s legitimate hoisting makes that design unsound, and the anchor-floor swing confirms it is not repairable by tuning. It is salvageable only by becoming a different design—move-aware alignment or source-interval union. The latter fits the current stamp model and fixes finding 1 directly.
- **Shipped manifests:** reproduced 11 failing and the stated four passing.

### Verification

- Full score run: **exit 0**
- Extraction suites: **4 files, 157 tests passed**
- Direct typecheck: **all 1,313 files covered and passed**
- `git diff --check`: passed
- `npm run typecheck`: wrapper hit the sandbox’s `tsx` IPC `EPERM`; the direct runner passed.
- Repository files changed by me: none.


---

## Review 5

### Verdict: FIX FIRST

The design is salvageable; do not back it out. But the central claim is still false: a badly reordered extraction can receive perfect exercised metrics, green gates, and passing assertions.

#### Findings

1. **Blocker — generated sections can be reversed across source IDs.**

   `generatedSpans` is maintained separately for each source ID in [scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1587). Consequently, the first generated node under every ID starts at `furthest = 0`, irrespective of where previous IDs appeared.

   I constructed twelve stamped source sections, each about 1,600 characters, and emitted them in reverse order as generated `<p>` children of their original stamped wrappers. The wrappers carry no own text, so the direct-order path skips them at [scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1681).

   Result:

   - 19,410 of 19,410 article characters credited
   - `requiredRecall = 1`
   - `articleRecall = 1`
   - `regionPrecision = 1`
   - `structureFidelity = 1`
   - attribution: green over 12 nodes
   - source order: green over 12 nodes
   - every assertion passed
   - no failures

   The complete article was backwards. The current arm catches reordering within one ancestor; it does not close generated-node reordering globally.

   The repair should place every newly covered source interval into one document-wide order coordinate, shared by direct and generated carriers. An interval adding no new ground can remain an ignored repeat, preserving the 28 `"["` markers. Add a permanent cross-ID generated-section reversal, preferably synthetic if no real fixture gives a clean transform.

2. **The runner can report successful measurement while selecting no fixture.**

   `--fixture definitely-not-a-fixture` exited 0, announced “All 0 fixtures move the card in both directions,” and reported all degenerate pairs satisfactory. The argument is read at [score.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:163) but never validated.

   Likewise, a missing fixture file is explicitly skipped at [score.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:209) without necessarily making the run fail. Both should fail closed.

3. **The denominator invariant is right and currently true, but its permanent test covers only six of thirteen fixtures.**

   I independently measured all thirteen: every stamped denominator exactly equals its visible-region reading, including 589,148/589,148 for Gutenberg and 54,900/54,900 for PG.

   However, the claimed permanent test loops `SMALL_FIXTURES` at [extraction-scorer.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-scorer.test.ts:1563), which contains only six fixtures. The other seven can regress silently. Make this loop all region-bearing fixtures or enforce it in the full runner.

4. **The artefact’s “schema on every row” claim is not enforced.**

   The test first filters to rows that already have `metrics`, then validates only those at [extraction-manifests.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-manifests.test.ts:482). Deleting `metrics` or `gates` from one exercised row still passes because the remaining count stays above ten. Arbitrary rows with neither `fixture` nor `conformance` are also ignored.

   The committed artefact is currently complete—116 exercised rows, all 116 carrying metrics and gates—but the test does not keep it that way.

5. **The stamped-page cache can silently return another document.**

   Its key is URL + byte length + first 256 characters at [arms.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/arms.mts:135). I supplied two different same-length documents with the same URL and prefix; the second call returned the first document’s `ALPHA_ONLY` tail instead of its own `BRAVO_ONLY` tail. The committed corpus’s unique URLs avoid this today, but synthetic tests and Stage C reuse make it an unnecessary instrument hazard. Key on the complete input or a collision-resistant digest.

#### The judgment calls

- **No blanket generated-node duplicate gate:** right. It knowingly false-reds correct footnote markers. Interval-union credit is the appropriate recall defence.

- **Ceiling invariant:** right, including the stated limitation. One source element genuinely holding the whole essay means the old overlap bug remained below the ceiling. The union, not the ceiling, fixes it.

- **Repeat-versus-reordering distinction:** sound within one source ID, but unsound as the whole order rule because it forgets order between IDs.

- **`forbiddenInsideRegion`:** sound now. Combined visible text after `except`, with positive, outside-region, and inline-boundary tests, matches the claimed semantics.

- **0.50 padding floor:** an honestly described backstop, not a blocker. Stage C must use relative `regionPrecision`, not treat 0.50 as a quality separator.

- **`assertionsPassed` excluding gates:** acceptable only if Stage C’s acceptance path always consumes gates separately.

- **Table-row semantics:** a legitimate declared limit, but it limits any Stage C conclusion about table-bearing pages. Such claims need a containment-aware check or manual evaluation.

The one-fixture generated-arm coverage is now a blocker because it omitted the cross-ID equivalence class above. The other listed items are limits under their stated scope.

#### Runs

- Full scorer: exit 0.
- Five extraction suites: 5 files, 187 tests, all passed.
- Typecheck: passed; all 1,313 source files covered.
- All thirteen denominator comparisons: exact.
- Repository-wide tests were attempted, but this restricted runner caused unrelated socket, subprocess, and local-Postgres `EPERM` failures; I stopped that run rather than treating environmental failures as repository evidence.

Also clean up the stale comments saying generated nodes receive no recall credit and that order is “Direct stamps only”; both now contradict the implementation.


---

## Review 6

### Verdict: FIX FIRST

Do not back Stage B out, but do not commit it as-is. The order gate is still unsound in both directions, and the runner can still report a successful empty evaluation.

#### 1. Blocker — a real reordering still receives a perfect card

The order implementation walks elements in preorder, while `ownTextOf` concatenates an element’s direct text nodes and discards where they occur among its children ([scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:107), [scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1605)).

I used this correct source order:

```html
<div data-spya-src="s2">
  <p data-spya-src="s3">Alpha first.</p>
  Middle second.
</div>
<p data-spya-src="s4">Omega third.</p>
```

Then moved the container’s own text before its child:

```html
<div data-spya-src="s2">
  Middle second.
  <p data-spya-src="s3">Alpha first.</p>
</div>
<p data-spya-src="s4">Omega third.</p>
```

The article changes from “Alpha, Middle, Omega” to “Middle, Alpha, Omega.” Results:

- every exercised metric: `1.00`
- `articleRecall`: `1.00`
- `regionPrecision`: `1.00`
- attribution: passed
- source order: passed over four nodes
- every assertion passed
- `detects`: nothing

The stamp preorder remains `s1,s2,s3,s4`, and `ownTextOf(s2)` remains “Middle second”; its position relative to `s3` has vanished from the representation.

This is a commit blocker, not a Stage C limitation. The gate still does not measure the claim “the article’s text arrives in source order.”

#### 2. Blocker — the container widening can false-red a correct extraction

A legitimate structural extraction can hoist the first child while leaving its original wrapper around the second:

```html
<!-- source -->
<div data-spya-src="s2">
  <p data-spya-src="s3">Alpha.</p>
  <p data-spya-src="s4">Beta.</p>
</div>

<!-- correct extracted text: still Alpha, Beta -->
<p data-spya-src="s3">Alpha.</p>
<div data-spya-src="s2">
  <p data-spya-src="s4">Beta.</p>
</div>
```

Attribution passes, but the new rule reports:

```text
source element s2 arrives after s3 — a reordering
```

That is the requested page shape outside the fifteen: splitting or partially unwrapping a source container without changing the reader-visible sequence.

I did not induce this from stock Readability in a small probe over fifteen crafted structural families. But it is a valid provenance-preserving DOM transform, and Stage C is precisely where such restructuring may be introduced. A hard gate used to accept Stage C cannot outlaw it accidentally.

The rejected “true global position” coordinate was paired with the wrong traversal. The experiment established that `querySelectorAll("*")` is not text order; it did not establish that global text position is invalid. A promising repair is to traverse `childNodes`, emitting text where it actually occurs among children, and map those segments to source intervals with the existing fresh-versus-repeat union rule.

Permanent tests should include both examples above: correct hoisting stays green; mixed-content reversal turns red.

#### 3. Blocker — review-five’s empty-selection failure remains

Validation accepts every name in `SCORABLE_FIXTURES`, although most have no manifest ([score.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:181)). The loop then silently skips a missing manifest ([score.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:241)).

Reproduction:

```text
node --import tsx evals/extraction/score.mts --fixture man-open
exit 0
All 0 fixtures move the card in both directions.
All exercised pairs lost something...
```

`man-open` is a known corpus fixture but has no manifest. A wholly missing manifest during a full run is skipped for the same reason.

Validate `--fixture` against manifest-bearing fixtures, reject a missing argument, and pin the intended manifest set so regenerating the artefact cannot silently shrink the corpus.

#### Other findings to fix in the same pass

- The exposure sweep missed two current overlaps. The gold+manifest conformance card reports 19 required exposures for 17 distinct passages and 32 exclusions for 30 distinct passages. Two manifest requirements duplicate gold body passages, and two manifest exclusions duplicate gold chrome. The concatenations are at [scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:867). This is not the main blocker, but the claim that every exposure was checked is false.

- `pmc-article`’s gate flip is an artefact. Its two observations are outer `div s30` and nested link `s36`; the generated paragraphs carrying almost all visible text are not order-judged. Swapping those paragraphs leaves `sourceOrder: true`, exposure 2, and `detects` empty. “All fifteen gates pass” is mechanically true, but PMC provides no new ordering evidence.

- The artefact schema check still trusts `exercised` before validating it ([extraction-manifests.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-manifests.test.ts:509)). Removing `exercised`, `metrics`, and `gates` from one scored row leaves it in the fixture/arm matrix but excludes it from schema validation; the remaining 115 rows clear the `>100` floor.

- The test named “judges the wrappers” only asserts exposure `>= 12` ([extraction-scorer.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-scorer.test.ts:1743)). The page already contributes 48 generated-node observations, so that assertion passes without counting any wrapper. The reversal assertion does make the rule load-bearing, but this particular exposure test does not prove what its name says. The correct current total is 60.

- The exposure refactor left `stamped` incremented but unused at [scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1594).

Confirmed good: the four extraction suites pass, 168/168; unknown names exit 1; cache keys use the complete input; the denominator check runs corpus-wide; missing fixture bytes fail; Stage C’s three preconditions are present; and the current artefact contains 116 exercised rows with the expected top-level metric and gate names.


---

## Review 7

### Verdict: FIX FIRST

There is one trunk blocker, reproduced in both requested directions. The clipping itself is correct.

#### Blocker — `descendant` text runs are omitted from the order coordinate

`sourceRefOf` classifies a generated wrapper containing a stamped child as `descendant` ([extract.ts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/src/extract.ts:511)). `provenanceForm` counts its own text for attribution, but explicitly excludes it from ordering ([scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1721)).

That produces both failures:

1. A real reordering passes.

   Source reads:

   ```html
   <div><i>child first</i>loose text second</div><p>omega</p>
   ```

   Reordered extraction reads:

   ```html
   <p>loose text second<i>child first</i></p><p>omega</p>
   ```

   The generated `<p>` resolves as `descendant`; its loose text is never placed in the order coordinate. Through a full manifest-bearing scorecard, clean and reordered cards were identical:

   - `requiredRecall` 1
   - `articleRecall` 0.60
   - `regionPrecision` 0.60
   - `structureFidelity` 1
   - attribution passed, exposure 3
   - source order passed, exposure 2
   - assertions passed
   - `detects`: no metric, no gate, `detected: false`

2. A correct, reader-identical restructuring is condemned.

   Schematically:

   ```html
   <!-- source -->
   <div>A<i>X</i>B<span>Y</span>A<em>Z</em></div>

   <!-- output -->
   <div><p>A<i>X</i>B</p><span>Y</span>A<em>Z</em></div>
   ```

   Both read exactly `A X B Y A Z`. In the actual probe all phrases exceeded the run thresholds. The generated `<p>`’s `A/B` runs are skipped; the final direct `A` then greedily resolves to the first identical `A`, behind the already-consumed `Y`. Source order fails: character 0 was reported after character 91.

This is not merely synthetic exposure. The shipped corpus currently contains **31 descendant own-text carriers holding 4,747 characters across six fixtures**, including 14 carriers/4,162 characters on `pg-greatwork`. The “zero false reds” measurement excludes those runs.

The durable fix is to align all output text runs monotonically against their possible source intervals, rather than choosing each element’s earliest cover independently and forgiving repeated ground. That would let the 28 `[` markers occupy distinct source occurrences, let a retained second occurrence map to the second occurrence, and reject an output sequence for which no monotone assignment exists. Simply assigning descendant text to its first stamped child would be wrong: that child did not own the wrapper’s loose text.

#### Clipping

The clipping at [scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1891) is mathematically sound and load-bearing. The `See note <a>1</a> above.` probe passes with exposure 4; the interval intersection correctly places the parent’s two pieces on either side of the link. Giving the first run the whole cover would advance past the link, exactly as described.

Add that worked example as a focused permanent test. The current `pg-greatwork` green test would catch the regression, but only indirectly.

#### Claims and evidence to correct

- “One coordinate, shared by every carrier” is false while descendants are skipped ([scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1784)).
- § B’s claim that the gates are decisive about reordering and duplication is too broad ([plan](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:811)). Generated duplication is explicitly not checked, and descendant reordering is currently unobserved.
- The success detail “none said twice” overstates what was checked ([scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1244)).
- The exact wrapper-test count is currently **48, not 60** ([extraction-scorer.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/tests/extraction-scorer.test.ts:1822)). It is a real assertion, but its page contains no descendant own-text carrier, so it cannot expose this omission.
- `MANIFESTS_EXPECTED` is a minimum, not an exact count pin: the condition is `< 15` ([score.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/score.mts:207)). The advertised unknown, missing-argument, manifest-less and mid-run-vanishing cases are closed. Exact corpus identity is a non-blocking maintenance limit unless replacement-without-count-change must also be prevented.

The `pmc-article` abstention, 14/15 result, exposure de-duplication, artefact validation, and selectable-set repairs check out. I reran the five `extraction-*.test.ts` suites: the current checkout reports **192 passed**, rather than 172.

No repository files were changed.


---

## Review 8

### Verdict: FIX FIRST

One trunk blocker remains.

#### Blocker — some `ancestor` runs still disappear from the alignment

For generated nodes resolving as `ancestor`, the order walk always restricts the run to the ancestor’s own text ([scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1802)). If an inline child was removed, the generated run can combine ancestor and child text, so the ancestor cannot supply it.

When that happens, `placeRun` returns neither a span nor `behind: true` ([scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1932)). The caller silently omits the run on the assumption attribution already rejected it ([scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1825)). But attribution deliberately checks generated nodes against the whole page and therefore passes it.

Reproduction:

```html
<!-- source -->
<div s1>A <i s2>X</i> B</div>
<p s3>Tail</p>
<p s4>Zulu</p>

<!-- clean generated structure -->
<div s1><p>A X B</p></div>
<p s3>Tail</p>
<p s4>Zulu</p>

<!-- reordered -->
<p s3>Tail</p>
<div s1><p>A X B</p></div>
<p s4>Zulu</p>
```

The generated `<p>` resolves to ancestor `s1`, whose own text is only `A B`. Its `A X B` run is omitted. Clean and reordered cards consequently had identical results:

- `assertionsPassed: true`
- every metric identical
- attribution green, exposure 3
- source order green, exposure 2

The missing third run is precisely the reordered content. This directly contradicts “reordering of any text run the output carries” in [the plan](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:1611).

Fix by ensuring an attribution-valid generated run that its guessed ancestor cannot supply still enters the page-level order alignment—or fail closed. Add this clean-green/moved-red case permanently and remeasure the corpus.

#### The two questions you highlighted

The `descendant` whole-page fallback is sound enough for observable text order: passing establishes that its runs form part of a monotone page-text subsequence. Repeated phrases make occurrence identity unknowable, but do not create an observable non-monotone sequence.

Greedy earliest-admissible placement is correct for the candidate spans represented here. Taking the earliest placement minimizes the cursor; later occurrences cannot finish earlier, including across an owner’s ordered pieces. It therefore cannot eliminate an assignment that a later placement would preserve.

#### Non-blocking correction and Stage C limits

The comment claiming `pmc-article` still abstains is stale: the current corpus run reports source order green with exposure 4, not `—` ([scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1162)).

Still legitimate Stage C limits, not trunk blockers:

- generated-node duplication remains unchecked;
- table containment/row semantics remain outside this ruler;
- acceptance must consume gates separately and treat the 0.50 precision floor only as a gross-padding backstop.

Independent runs: five extraction suites passed, 195/195; the full corpus runner exited 0; `git diff --check` passed. No repository files changed.


---

## Review 9

### Verdict: FIX FIRST

One trunk blocker remains. Return it to the owner.

#### Blocker — the subtree is the right boundary, but the retry is not a sound alignment

An `ancestor` run is first matched exactly against the ancestor’s concatenated own text; only if that text cannot supply it is the run matched exactly against the full subtree ([scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1818), [scorecard.mts](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/evals/extraction/scorecard.mts:1857)).

I reproduced two false reds:

1. Partial flattening. One inline child is flattened into a generated paragraph while another child is omitted:

   ```html
   <!-- source -->
   <div s1>A <i s2>X</i> B <button s3>navigation</button> C</div>
   <p s4>Tail</p>

   <!-- extraction -->
   <div s1><p>A X B C</p></div>
   <p s4>Tail</p>
   ```

   Attribution passes. The output preserves every retained character’s order; it merely selects out one child. Nevertheless `sourceOrder` fails with “could not be placed in the source at all,” because `AXBC` is neither the ancestor’s own `ABC` nor an exact substring of its `AXBnavigationC` subtree.

2. Repeated text. With source `<div s1><i s2>Alpha</i>Alpha</div>`, a clean `<div s1><p>Alpha</p>Alpha</div>` is rejected. The generated paragraph is placed at the later occurrence in `s1`’s own text instead of the earlier subtree occurrence; the remaining direct run is then called reordered. In my run, attribution passed and source order failed over three runs.

Thus the implementation is not performing the documented “earliest admissible” assignment over the actual candidate set. The subtree is the correct spatial tightness, but it cannot be an exact-match fallback after owner matching. An `ancestor` run needs subtree-local monotone/subsequence placement that permits legitimate child deletion, choosing the earliest result across valid placements.

The permanent test is not inert: its exposure-3 assertion genuinely closes the exact silent skip, and its unique-text moved case goes red. It simply covers only complete, unambiguous flattening.

#### Recorded limits, not blockers

- Deferring the 4,162 descendant characters is defensible. The 0.9237 is a bounded lower measure, not meaningless: `50,711 / 54,900` are credited and the 48,000 floor retains 2,711 characters of useful margin. But stage C must not treat it as exact cross-extractor recall: wrapper-shape changes can move the number without changing visible text, and regressions confined to those 4,162 characters are invisible.
- The unbuilt shape corpus is not independently a trunk blocker. Its framing is honest and correct. It should be an early stage C precondition before general claims are made from gate greens, not retroactively presented as coverage stage B already has.

#### Documentation correction

The plan still states that `pmc-article` abstains and that only fourteen shipped extractions pass both gates ([plan](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:879), [plan](/home/greg/code/spideryarn2/.claude/worktrees/extraction-repair-evals/docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md:888)). The committed run actually has `pmc-article` source order green at exposure 4, and all fifteen pass both gates. That also contradicts the later statement that the tally is nowhere written. Fix this alongside the blocker.

Independent check: all five extraction suites passed, 197/197. No repository files changed.
