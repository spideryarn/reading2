## Verdict: the free fix is real; the model result is not yet a repair result

The un-hide experiment is persuasive for this page. The model experiment currently proves only that two models can classify the inventory rows plausibly.

It does not yet prove that either model repairs an extraction:

- There is no human gold, so selected ids are called “restores” without establishing that they should be restored.
- [`rescue.mts`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/rescue.mts:200) totals selected ids, then writes those ids to JSON. It never constructs or scores repaired HTML.
- Partial blocks are credited at their full size. That counts text already present as restored.
- Detection is not measured independently. `compare()` decides which rows deserve inspection; pages with no candidates skip the model entirely. The model therefore cannot detect wrong-container, retained-boilerplate, order, duplication, structural or acquisition failures that `compare()` misses.

I would describe the result as: “Luna and Sonnet classified candidate omissions on two pages.” Rungs 3 and 4 have not yet been demonstrated.

## 1. The control is better, but it still flatters the model

The `survived === 0` correction fixes the specific leak of kept short headings. It does not make the population a gold-labelled control.

The main problem is that “restore everything” is only a boundary condition, not a scored null. There is no definition of correctness against which Luna beats it. “Luna differs from it on 22 rows” establishes selectivity, not quality.

There is also a scoring error. Candidates include `partial` rows, but `recovered` adds every selected row’s full character count ([`rescue.mts`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/rescue.mts:163), [`rescue.mts`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/rescue.mts:205)).

For the Constitution:

- Stock: the reported 49,753 consists of 48,064 characters from dropped rows, 1,213 from partial rows, and 476 from short rows.
- Post-unhide: the reported 10,502 consists of 9,046 dropped, 1,316 partial and 140 short.
- Weighting partial rows by their unmatched shingle fraction gives roughly 9,635 potentially missing characters post-unhide, not 10,502. Even that is an instrument estimate, not gold.

That is why “restored” exceeds `droppedChars` in both runs.

A much stronger cheap baseline is already implicit in the results: restore every dropped or partial fingerprintable row, restore no short row, and reject obvious chrome using semantic ancestry, tag and link density. Luna selected 124 of the 125 long Constitution candidates, rejecting only the copyright line; on Noema it selected both long candidates. Most of its apparent work is therefore “restore nearly every long candidate, reject short footer/navigation.”

I would score at least these baselines against hand labels for the existing 186 rows:

1. Restore none.
2. Restore everything.
3. Restore all dropped/partial rows but no shorts.
4. The same, excluding `header`/`nav`/`footer`, controls and high-link-density regions; attach short headings only to selected prose runs.

The DOM paths already make much of this trivial. A link/text-density baseline is worth adding, but ancestry and source-order runs are cheaper and more directly relevant. Without labels, none of the four can be said to win.

## 2. Most model value disappears after un-hiding

The post-unhide run was the right experiment, and it settles the overlap question: the interventions are largely redundant. The free intervention owns about four-fifths of the initial opportunity.

The residual is also qualitatively different from the original failure. Luna’s 37 selected rows contain approximately:

- 2,639 characters of hero/preface material.
- 3,968 characters of the publisher’s “summary of the Constitution.”
- 3,013 characters of acknowledgements.
- 630 characters of accordion summaries that mostly already survive.
- 252 characters from another mostly-surviving paragraph.

This is not 10,502 characters of still-missing central body prose, and it is not merely “the opening block and the author bio,” as the plan says ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/readability-repair-pass.md:178)). It is front matter, a deliberately duplicative summary, acknowledgements, and partial repetitions. The main collapsed body is the part un-hiding recovered.

On this page, I would not pay for a model. I would first decide whether Spideryarn wants the publisher summary and acknowledgements at all. Then implement one deterministic candidate using the DOM regions already visible in the paths.

The experiment that settles the page-specific residual does not require a corpus:

1. Human-label the 59 post-unhide candidates, explicitly deciding preface, publisher summary, pull-quotes and acknowledgements.
2. Actually assemble the deterministic and model-selected repairs in source order.
3. Score only previously absent text, plus duplication, order and structure.
4. Run stage 3 twice and measure block-id stability.

A corpus is still required before shipping either global un-hiding or a model repair generally.

## 3. Luna–Sonnet agreement is less impressive than the totals suggest

On the Constitution, Sonnet’s 125 selections are a strict subset of Luna’s 135. Their only disagreement is ten acknowledgement paragraphs: Luna keeps all ten; Sonnet rejects all ten.

On Noema they agree only on the 144-character standfirst. Luna additionally selects `n102`, the pull-quote that `compare()` already says is 88.9% present. That may be valid page structure, but it is weak evidence of recovered content and could create duplication.

So the models agree on the obvious prose and chrome, while disagreeing exactly at the policy boundaries. That is consistent with an easy lexical task, but it is also exactly what a shared “prefer to keep” prompt would produce. It does not establish Luna’s parity with Sonnet.

For one cheap discriminating run, I would use post-unhide Luna again, but:

- shuffle the rows;
- ask for furniture rather than article, taking the complement;
- remove the title, kept-block totals and “prefer to keep” instruction;
- use independently worded, symmetric error costs.

Stable per-id decisions would support “the rows themselves make this easy.” A large shift, especially outside acknowledgements and pull-quotes, would show prompt or presentation anchoring. One run still says nothing about stochastic reliability; the rewritten plan correctly requires repetitions but the saved experiment has only one per model.

## 4. The fifth `compare()` bug is multiplicity

The LIS check operates independently for every source row. Two rows can therefore claim the same output occurrence.

Concrete input:

```html
<!-- raw -->
<article>
  <p>alpha bravo charlie ... sierra tango</p>
  <aside><p>alpha bravo charlie ... sierra tango</p></aside>
</article>

<!-- extraction: only one copy -->
<p>alpha bravo charlie ... sierra tango</p>
```

Using a 20-word sentence, current `compare()` reports:

- both rows `kept`;
- both `survived: 1`;
- `keptChars: 246`;
- `dropped: 0`;
- `coverage: 1`.

Only 123 characters exist in the extraction. Both rows reuse the same `articleText.indexOf()` positions. The ratio is 0.5 and may signal an anomaly, but the inventory cannot say which copy disappeared, and `rescue.mts` sees no candidate and makes no call.

This is the duplicate-teaser/headline case the source comment acknowledges but the tests do not pin down. Direct source-id provenance would fix it once integrated; the reported provenance percentages alone do not.

There is another threshold counterexample: a single 1,000-unique-word source block truncated to its first 910 words returns `kept`, with `survived = 0.909`, `dropped = 0` and no gap. `coverage` remains 1. A consequential tail can therefore disappear inside a large block without entering the model population.

## 5. What remains wrong in the rewritten plan

The plan absorbed the important conceptual corrections: source-order selection, id churn rather than automatic reminting, detection risk, residual-first measurement, immutable golds and representative regression sampling.

But it now overstates what was built:

- “Rungs 3 and 4 measured” is false. Candidate classification was measured; neither general detection nor an assembled repair was.
- The provenance experiment is not wired into `compare()`. It remains build-order step 2 ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/readability-repair-pass.md:362)).
- “92.7% of output elements carry an id” is output-side provenance coverage, not source-content recall.
- The results do not save the raw API response, prompt hash, provider identity, finish reason or repeated runs, despite the plan requiring those.
- “48,147 characters, 26%” conflates two measures. Visible raw minus extracted is 50,439 characters, or 26.3%. `droppedChars` is 48,147, or 25.1%, because partial and short rows are excluded. Post-unhide, those corresponding figures are 11,084 versus 9,129.

## 6. The earlier ratio table was wrong for this harness

You are correct.

The current instrument consistently strips `script`, `style`, `noscript`, `template`, `svg`, `head` and `title`, then applies the same normalisation to both sides ([`inventory.mts`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/inventory.mts:277), [`inventory.mts`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/inventory.mts:327)). I reproduced:

- Constitution: 141,436 / 191,875 = **0.7371**
- Noema: 52,643 / 54,028 = **0.9744**
- Writes: 3,096 / 3,096 = **1.0000**

The Constitution’s scripts contain 401,091 of its 592,942 unstripped `body.textContent` characters: 67.64%.

My earlier 0.239 / 0.873 / 0.535 table used the wrong denominator. Worse, the Noema 0.873 combined unnormalised extracted text with normalised raw text, so it did not even apply one normalisation consistently. The table should be withdrawn, not merely qualified. The broader warning—that raw/extracted length is an anomaly signal rather than a quality score—still stands.