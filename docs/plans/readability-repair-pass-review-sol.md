# Verdict

Do not build the plan as written.

There is enough evidence to justify an extraction-quality investigation, but not enough to justify a model on every ingest. The first experiment should measure Readability’s error rate and compare it with deterministic alternatives. The proposed inventory and scorer are too lossy to answer that question reliably, and design B preserves provenance without preserving meaning.

My recommended scope is:

1. Build a real, immutable extraction benchmark.
2. Run stock Readability and deterministic variants or alternative extractors.
3. Measure prevalence on a representative long-form sample.
4. Only then test model detection.
5. Defer model repair until detection is demonstrably useful.

# 1. Is the premise true?

The weak version is true: Readability has silent failures, including lost middle sections, wrong containers and retained boilerplate. The strong version—these happen often enough in Spideryarn’s target material to justify a paid second pass—is unproved.

There is some external evidence that the gap is material. A new 2026 benchmark reports Readability at 0.825 mean word F1 on 793 article pages, versus 0.926–0.932 for its leading systems. That is large enough to investigate. But its “article” category includes news, guides and reviews, and mean F1 does not tell us how many pages are catastrophically wrong rather than slightly noisy. It is not a prevalence estimate for long essays. The benchmark is also new and its annotations were model-assisted before human review, so I would treat it as a useful corpus, not final truth. [WCXB benchmark and article results](https://github.com/Murrough-Foley/web-content-extraction-benchmark#baseline-results)

The repo itself has only three cached HTML articles. That is no prevalence evidence. All three appear usable. The current implementation does exactly one default Readability parse and only rejects `null` ([extract.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:205)); it has no quality history to mine.

My prior is:

- On static, conventional long-form pages—the product’s centre—serious Readability failures are probably uncommon.
- Some important failures are genuinely silent, so “uncommon” is not “unimportant.”
- Many loud modern-web failures are acquisition failures: JavaScript-only body, paywall, consent challenge, truncated server response. If the prose is absent from `raw.html`, neither the inventory nor design B can recover it. That belongs in stage 1, potentially through an explicit rendered-page acquisition method.
- A post-Readability model is therefore unlikely to be the best universal first intervention.

What would settle it: run the exact installed Readability 0.6.0 over the WCXB article subset, then manually review a stratified Spideryarn-like subset—long, mostly prose, preferably essays and papers. Separately sample 100–200 real URLs from the intended ingest distribution. Report catastrophic failure rate, not merely average F1.

If fewer than roughly 2–3% have consequential silent failures, I would ship deterministic checks plus a visible “try another extraction method” path, not a model on every ingest.

# 2. The inventory loses the information the decision needs

The proposed row is not an adequate before/after representation:

```text
id | tag | depth | chars | kept? | snippet
```

## A concrete impossible case: S

Suppose the raw page contains:

```html
<table>
  <tr><th>Treatment</th><th>Result</th></tr>
  ...
</table>
```

Readability emits all the cell text, but flattens it into paragraphs or puts cells in the wrong row order. Every raw row may say `kept? = yes`. The inventory contains the raw tag, but no output tag, output ancestry or output order. The model literally cannot distinguish “table preserved” from “words survived as an unordered bag.”

The row needs at least:

```text
source tag/path/order
output occurrence count
output tag/path/order
```

The same defect makes **D/order** impossible to see. A boolean says that sections A, B and C survived; it cannot say Readability emitted A, C, B. For duplication it needs all output positions, not a boolean.

## Normalised-text lookup is not a node mapping

It fails in several ordinary cases:

- A teaser repeats the headline or first sentence from the article. Both raw nodes become `kept? = yes`, although only one survived.
- A parent contains both article prose and a dropped related-links child. Its complete normalised text is absent, so the parent says “not kept” while most of its content was kept.
- The same copyright sentence or callout occurs multiple times. A substring lookup loses multiplicity.
- Readability converts `div` elements into paragraphs, creates wrappers, unwraps nodes, removes duplicate title headings and moves siblings into its chosen article. Text survival does not establish node identity.
- Images, equations and empty structural wrappers have no useful text key.
- A table can retain the same text while losing its structure.
- Truncating a long node still gives a plausible snippet and may defeat an exact full-node lookup.

There is a much better deterministic mapping: stamp every raw element with a temporary source id before passing a clone to Readability, and request a DOM result using Readability’s `serializer` option. Mozilla documents both the destructive DOM behavior and the DOM serializer option. [Mozilla Readability API](https://github.com/mozilla/readability#api-reference)

I tested that mechanism on the cached Noema page. Of 317 elements in Readability’s output, 294 retained their temporary source id; the remaining 23 were mostly wrappers and paragraphs Readability created. That gives direct provenance for almost everything and a bounded set of generated nodes to map through descendants. It is much stronger than text lookup.

## Dropping attributes is backwards

Readability itself relies heavily on classes and ids. Its installed implementation explicitly treats names containing `comment`, `related`, `sidebar`, `footer`, `article`, `content`, `main`, and similar terms as positive or negative evidence. Mozilla’s own maintainers describe it as largely heuristic and class/id-based. [Mozilla algorithm discussion](https://github.com/mozilla/readability/issues/9)

The model should not receive every byte of every attribute, but it should receive bounded semantic features:

- tokenised `id` and `class`
- `role`, `aria-label`, `itemprop`
- `article`, `main`, `nav`, `aside` ancestry
- source parent id and sibling position
- link density and text density
- descendant counts for paragraphs, links, images, tables, code and headings
- hidden/inert/dialog signals
- output tag, parent and positions
- a text hash plus head and tail snippets, not merely the first 120 characters

Random CSS-module hashes can be dropped. Human semantic tokens should remain.

Calling the initial inventory “the diagnostic that tells us whether the premise holds” is therefore circular ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/readability-repair-pass.md:154)). A lossy detector cannot establish the prevalence of failures it cannot represent.

# 3. Design B is source-grounded, not safe

“The model only points” protects against invented prose. That is valuable. It does not protect the article’s meaning.

A wrong `insert-after` can:

- move a qualification away from the claim it limits;
- place a section’s conclusion under another heading;
- move footnotes or captions to the wrong referent;
- interleave two versions of the same article;
- duplicate a subtree by selecting an ancestor and a descendant;
- put `tr`, `li` or `figcaption` outside its required wrapper;
- reverse chronology or argument order while retaining every original character;
- copy a broad container that includes the exact boilerplate the repair was meant to remove.

That can be worse than one hallucinated sentence because every word passes the provenance check. Source-derived does not mean faithful.

The “byte for byte” claim is also false ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/readability-repair-pass.md:51)). Parsing, DOM cloning, serialisation and sanitisation change entity encoding, whitespace, attributes and markup. The defensible claim is “all emitted text originates in source text nodes.”

If B is tested, I would remove arbitrary `insert-after`. Make the model return a source-order inclusion mask or contiguous source ranges. Deterministic code should then enforce:

- no ancestor/descendant overlap;
- no node emitted twice;
- source order preserved;
- required wrappers reconstructed deterministically;
- every emitted text span traceable to one source location;
- sanitisation after assembly;
- an explicit hard failure on invalid or ambiguous operations.

That is less expressive, intentionally. If the repair requires free reordering, it is no longer a safe selector.

## The missing third design: candidate selection

Before node surgery, generate several deterministic candidates and let either rules or a model choose one whole candidate:

- stock Readability;
- Readability over a credible semantic root such as `main`, `article`, or `itemprop=articleBody`;
- a minimally pre-cleaned DOM with known overlays and consent UI removed;
- one or two Readability parameter variants;
- a second deterministic extractor such as Trafilatura, initially in the eval only.

Whole-candidate selection preserves each extractor’s internal order and structure. The model makes a bounded choice rather than writing a document.

Be careful with `charThreshold`: Readability already reruns extraction with progressively less aggressive flags when the result is under the threshold. Raising or lowering it changes when those fallback passes happen; it is not a simple “retain more text” dial. Other exposed inputs include `nbTopCandidates` and `linkDensityModifier`. [Mozilla Readability options](https://github.com/mozilla/readability#new-readabilitydocument-options)

Per-domain rules are worthwhile after the same domain fails repeatedly. They are cheap and deterministic at runtime, but they rot and should not be the first general design.

Rendered-DOM acquisition is also a real alternative, but it belongs in stage 1. It solves missing source content; post-processing does not.

# 4. The eval would currently answer very little

Typed assertions are good regression checks. A handful per fixture is not a comparative gold.

“One sentence near the end” catches one form of truncation. It does not catch a missing middle section, a dropped paragraph next to it, reordered claims, a wrong caption, or extra boilerplate elsewhere. Both arms can easily score 90–100% while differing materially.

The PDF lesson has been read backwards. Its README says the missing golds make its current figures a smoke test rather than a gate ([pdf README](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/pdf/README.md:5)). The lesson is to create adequate golds here, not to choose another sparse substitute.

## Full-text golds do not rot

A web fixture should contain immutable cached `raw.html` with a hash. If the publisher later edits a typo, that is a new fixture version; it does not modify the committed input. The PDF fixtures already state exactly that rule for their bytes ([pdf README](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/pdf/README.md:36)).

You do not necessarily need to hand-transcribe prose. Label source DOM nodes or source text spans as:

```text
main / boilerplate / metadata / excluded
```

Then derive the expected text deterministically from the frozen source. Human work is deciding boundaries, not retyping the article. The public WCXB corpus already includes complete main-content golds plus required and forbidden snippets.

## The raw-content ratio is invalid here

The older harness compared extraction length against a known desired synthetic document ([original extraction doc](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/original-version/extraction.md:139)). The plan changes the denominator to all raw-page text, which contains navigation, embedded application data, scripts and duplicate mobile/desktop markup.

On the three cached HTML pages, I measured:

| Article | extracted/raw text ratio |
|---|---:|
| Constitution | 0.239 |
| Noema | 0.873 |
| Writes | 0.535 |

The proposed inherited bands would strongly penalise the Constitution extraction simply because its raw page contains about 593,000 text characters around a 141,000-character article. That ratio is an anomaly feature that must be calibrated per corpus or template, not a quality score.

## Scoring unit

Use three levels:

1. **Primary: article-level acceptability.** Did this arm produce an article safe to put on the shelf? One critical missing section should fail the article.
2. **Secondary: source-token or character-weighted precision and recall.** This measures the severity of omissions and contamination. Token-level scoring is less brittle than raw character equality.
3. **Separate structural metrics.** Tables, headings, lists, code, captions, footnotes and order need typed checks because bag-of-words F1 cannot see them.

Do not make extracted blocks the fundamental gold unit. Arms can split or merge blocks differently and game block counts. Node-selection accuracy is useful for diagnosing B, but the reader-facing metric is faithful text and structure.

Statistical uncertainty must be clustered by article. A hundred assertions from one page are not a hundred independent observations; the repo’s own eval guidance already warns about drawing a verdict from correlated samples ([evals README](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/README.md:146)).

## How many fixtures?

For an initial design comparison:

- 30–50 genuine hard articles can detect a large repair effect.
- At least 100 representative ordinary articles are needed for a useful regression estimate.
- If zero regressions occur in 100 pages, the rough 95% upper bound is still about 3%. To support a claim below 1%, you need about 300 clean pages with zero regressions.
- Every important failure family should have several domains, not one handcrafted fixture.

An enriched hard set estimates “can it repair known failures,” not “is it worth running in production.” Production value also needs the prevalence sample.

## Model variance

For each model arm:

- freeze raw fixture hash, prompt hash, exact model id, provider settings and operation schema;
- save every raw response;
- run at least three independent uncached repetitions per fixture, preferably five on the locked test set;
- report mean, worst run and failure probability;
- bootstrap paired differences by article;
- keep a development set for prompt changes and a locked test set;
- score blindly and deterministically;
- report detector precision and recall, not accuracy, because failures will be rare.

The PDF reader is instructive here: Luna once dropped thirteen words from a page it had previously read correctly, so the implementation retries and only caches answers that pass an independent check ([pdf-read.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pdf-read.ts:741)). The web proposal has no comparably independent witness. Its inventory is derived from the same DOM and partially from Readability’s output.

# 5. Things the plan has backwards

## Design C does not automatically remint every id

The plan says a rewritten document causes every id to be reminted ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/readability-repair-pass.md:69)). The block-id contract says the opposite: stage 3 carries ids from the previous `blocks.json` by matching tag and text, even though stage 2 always writes a fresh document ([block-ids.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/block-ids.md:65)).

C would cause id churn when it edits words, changes tags, splits or joins blocks. That remains an excellent reason to reject it. But “new document means all ids are lost” is factually wrong.

B can also cause churn by dropping blocks, changing their tag through reconstruction, or selecting a different candidate on the next run.

## “If B fails, C cannot rescue it” is too strong

B may fail because its operation language cannot split a mixed container or reconstruct lost structure. C could technically do those things. C should still be rejected because its fidelity cannot be trusted—not because it lacks expressive power.

## Detection is not harmless

A false positive can reject a good article, trigger a paid repair, or tell the reader the publisher’s text is suspect. Detection needs a low false-positive rate measured at the real base rate.

## Sonnet is not a complete ceiling

If Luna and Sonnet both fail on the same lossy inventory, that may indict the representation, not repair by reference. Add a `detect-sonnet` arm if the experiment reaches models. Otherwise detection failure and repair-language failure remain confounded.

## The “fifth number costs nothing” does cost something

Running repair arms on easy articles invokes each model. The regression measurement is essential, but not free ([plan](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/readability-repair-pass.md:142)).

## The taxonomy mixes causes and outcomes

T, W and B overlap. A wrong container often manifests as truncation plus boilerplate. D combines duplication and order, although their checks differ. S combines content loss with structural loss.

I would use these axes instead:

- acquisition completeness: was the article present in the fetched DOM?
- content recall: how much desired prose survived?
- content precision: how much non-article text survived?
- order and duplication;
- structural fidelity;
- metadata fidelity: title, byline, date, language;
- link/media fidelity.

`null` is not the only loud failure; exceptions and absent acquisition are loud too. Conversely, a non-null 600-character paywall message is not “success.”

# A smaller plan

Cut repair entirely from the first spike.

Build only:

1. A frozen corpus adapter, beginning with WCXB’s article pages plus the current three articles.
2. Direct source-id provenance through Readability—not normalised-text lookup.
3. Full-text token precision/recall, order checks, typed structural checks and article-level critical failures.
4. Stock Readability plus deterministic candidate variants and one strong rule-based extractor.
5. A representative prevalence sample and an explicit decision threshold.

If that shows a meaningful residual failure rate that deterministic candidates do not close, build model detection next. Only if detection is stable across repeated calls should design B return, with source-order selection and hard structural invariants rather than unrestricted `insert-after`.

That smaller experiment can answer the premise. The current plan starts designing a repair before it has a trustworthy way to establish that repair is needed.