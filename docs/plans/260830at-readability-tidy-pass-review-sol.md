## Verdict

**CHANGE THE RECOMMENDATION.** The Paul Graham headline is real, but the evidence does not support shipping the generic `no \p{L}` rule or choosing Luna yet.

Keep the detection-only posture. First repair the eval, test safer structural rules, and rerun the model on the actual residual.

## Ranked findings

### 1. Blocker — the instruments do not run the current pipeline

**Claim:** `probe.mts` and `tidy.mts` run “real stage 2 + stage 3.”

**Why unsupported:** They call `unhide → Readability → splitIntoBlocks` directly ([probe.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/probe.mts:130), [tidy.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/tidy.mts:230)). Production stage 2 additionally calls `canonicaliseNotes`, rejects a null Readability result, sanitises, and wraps the article ([extract.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:286)).

That changes the evidence materially:

- The omitted `acx_footnotes.html` fixture reports 118 blocks and 18 markers through `probe.mts`.
- With production note canonicalisation, it becomes 96 blocks, zero markers, and proper `footnote` roles.
- Tufte also changes from 63 to 68 blocks.
- `probeHtml` catches every splitter exception and converts it into zero blocks, zero markers, zero tiny blocks—a broken splitter can look perfectly clean ([probe.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/probe.mts:152)).

There are 21 committed fixtures, but `CORPUS` contains only 20: the dedicated modern-footnotes fixture is missing ([README](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/fixtures/README.md:86), [corpus.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/corpus.mts:73)).

**What settles it:** Export one side-effect-free production stage-2 transform and make both instruments call it. Include all 21 fixtures. Make parse/split failure a failed row, never a clean zero.

### 2. Blocker — the proposed marker rule would delete real content

**Claim:** A gistable block with no letter “is not a passage” and requires no judgement.

**Why wrong:** There are two different definitions:

- `probe.mts`: no letter **and ≤6 characters**, because markers are a subset of `shattered` ([probe.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/probe.mts:158)).
- `tidy.mts` and the recommendation: no letter at **any length** ([tidy.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/tidy.mts:123)).

The shipped rule would therefore remove every standalone numeric or symbol-only block, including:

- numeric table cells, percentages, dates and numbered answers;
- equations such as `1 + 1 = 2`;
- chess results and castling such as `1–0` and `0-0`;
- scorelines, phone numbers, Unicode-only numerals;
- a deliberate em-dash dialogue line or scene break.

CJK, Arabic, Cyrillic, Greek, Hangul, Hiragana and Devanagari do match `\p{L}` and survive. Most chemical formulae (`H₂O`) and chess moves (`Nf3`, `e4`) also survive. The danger is specifically valid digit/symbol-only content.

The corpus contains no negative control of that kind, so 100% marker “precision” could not have failed.

**What settles it:** Do not ship the generic rule. Add numeric tables, equations, scores, symbol-only verse/dialogue, chess results and numeric list items. Prefer structural rules such as isolated affordance links, footnote roles, or code labels adjacent to code.

### 3. High — the control does not discriminate numerically

**Claim:** Hamlet and the short Tufte/MDN/WHATWG blocks prevent “drop everything short” from scoring well.

**Why wrong:** For the instrument’s defined short cut, ≤6 characters, the trivial policy scores:

- marker recall: **246/246**;
- prose alarms: **0**;
- unknown ids: **0**;
- total blocks dropped: **544**;
- non-marker blocks dropped: **298**—18 headings plus 280 others.

Hamlet contributes **zero** blocks at ≤6, so it is inert. It only begins discriminating after inventing a higher threshold: ≤40 deletes 18/52 Hamlet blocks; ≤200 deletes 38/52.

The ≤6 policy also deletes 196 WHATWG blocks, two Tufte headings, and 33 MDN blocks including `Syntax`, `Age`, and `public`. But there is no gold or failed score for that damage: all 298 are merely printed under `beyondTheRule`, which is presented as the model’s valuable output ([tidy.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/tidy.mts:321)). Numerically, the bad baseline looks excellent.

Also, Hamlet’s 52 blocks are not “52 verse lines.” They are mostly speeches; the longest block is 1,539 characters.

**What settles it:** Commit protected/drop labels for candidate blocks and report precision and recall for the trivial baseline. Keep printed text as audit evidence, not as the only control.

### 4. High — the false-positive statement omits a known error

**Claim:** Luna had “one false positive in three runs on one of twenty pages.”

**Why misleading:** The full Luna artifact already contains another false positive: the Gutenberg plate caption `Ruskin House…`, which the prompt itself says must be kept because captions are article content ([result](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/results/extraction-tidy-openai-gpt-5-6-luna-20of20.json:1781)). The write-up acknowledges it, then omits it from the rate.

Thus there are at least two known content deletions across the 20-page run plus two additional PG repetitions: **2/22 page-runs**. Treating those as independent binomial observations—already an unjustified simplification—gives a 95% exact interval of approximately **1.1%–29.2%**. Taking only the PG repetitions, 1/3 gives **0.8%–90.6%**.

Neither estimates the real quantity: the probability that an ordinary article loses any genuine content. Three PG runs estimate PG-specific variance, not cross-page risk. Manual labels based on 140-character snippets can also miss false positives.

**What settles it:** At least 100 ordinary articles, complete independent review of every proposed deletion, several uncached repetitions, and uncertainty clustered by article. Zero errors in 100 would still have a 95% exact upper bound of about 3.6%.

### 5. High — the model was not evaluated on the residual

**Claim:** The free rule is computed first and the model is scored against the residual.

**Why misleading:** The accounting separates markers from `beyondTheRule`, but `ask()` still sends **every row, including every marker**, to the model ([tidy.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/tidy.mts:254)). The prompt also contains extensive marker examples.

Therefore the proposed arm—remove deterministic candidates, then ask Luna about what remains—has not been run. Its context length, attention pattern, output and cost may differ.

**What settles it:** Remove deterministic candidates before constructing the prompt, then rerun. Compare against a richer non-model baseline using tag, href, class, adjacency, repetition and same-page-link density.

### 6. High — the model comparison is incomplete and internally inconsistent

**Claim:** The table compares three models “over twenty pages” and supports “do not pay for Terra or Sonnet.”

**Why unsupported:**

- Luna completed 20/20.
- Terra completed 14/15.
- Sonnet completed 9/15, not merely “RFC failed.” Five other attempted fixtures are also absent.
- Sonnet’s RFC attempt took about 234 seconds before exhausting 16,000 tokens; reporting 72 seconds as its slowest page excludes the failure.
- Luna’s saved slowest completed page is **40.2s**, not 27s ([result](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/results/extraction-tidy-openai-gpt-5-6-luna-20of20.json:77)).
- Terra did not have “better marker recall”: it caught 89/139 overall and 77/127 on RFC, versus Luna’s 219/246 overall and 118/127 on RFC ([Terra result](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/results/extraction-tidy-openai-gpt-5-6-terra-14of15.json:35)).
- `$0.07 / 20 = $0.0035` per page, not the claimed `$0.002`. The result files carry no cost field, so the quoted totals are not reproducible from them.
- One Terra/Luna run cannot separate model quality from variance on RFC’s ToC.

**What settles it:** Matched fixtures, three repetitions, actual residual input, costs including failed attempts, and a chunked-versus-unchunked comparison. Until then, postponing expensive models is sensible budgeting, not an evidence-backed quality decision.

### 7. Medium — several headline-adjacent numbers are stale

The core PG finding survives, but nearby claims do not:

- Current output is exactly **66,518 → 66,518 characters, ratio 1.000, zero dropped characters, 328 blocks, 87 markers**. Sound.
- `87/328 = 26.5%`, reasonably reported as 27%.
- The source has zero `<p>`. Sound.
- Current Readability emits **231 `<p>`**, and stage 3 produces **265 `<p>` blocks**, not 266.
- `probe.mts`’s header still says 330 blocks / 88 short, contradicting its own current output of 328 / 87 ([probe.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/probe.mts:30)).
- “Four of the five new fixtures score perfectly on droppedChars” is false now: current dropped counts are MkDocs 156, Whitman 0, Hacker 1,031, MacTutor 1,539, Hamlet 208. Only Whitman reports zero.
- Whitman’s ratio rounds to 1.000, but extracted text is 16 characters shorter; “nothing dropped” describes `compare().droppedChars`, not literal character equality.

**What settles it:** Generate the write-up table from a committed result artifact and assert the important fixture values in tests.

### 8. Medium — lowering `PROSE_CHARS` only moves the blind spot

The write-up correctly admits that 100 is no better justified than 200. The stronger problem is that `prose` claims to print full blocks, but `TidyRow.text` was truncated to 140 characters before scoring and saving ([tidy.mts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/tidy.mts:242)). A short heading, definition term or numeric table cell can be more damaging than a long paragraph.

**What settles it:** Store full selected text plus previous/next block and DOM context. Use length only to order human review, never as a safety alarm or gate.

## Prompt assessment

The two asymmetric lists are a better base shape than “lots of before/after examples.” This is classification, not rewriting, and many examples risk teaching superficial length patterns.

What is missing:

- keep: numeric table cells, equations, scores, dates, chess results, symbol-only dialogue;
- keep: acknowledgements, bylines, captions, licence text and author-created contents/indexes unless product policy explicitly says otherwise;
- distinguish: citation labels and backlinks from disposable stranded markers;
- distinguish: the document’s own ToC from site navigation;
- context: previous/next block, `href`, class/role, parent tag and repetition count;
- a two-phase answer such as `drop`, `keep`, or `needs-context`, rather than forcing uncertainty into keep/drop.

A few adversarial labelled examples around those boundaries would help. “Lots” would not.

## Claims checked and found sound

- The Paul Graham failure is real despite ratio 1.000 and zero `droppedChars`.
- The ids-only schema prevents rewriting and reordering; invented ids become no-ops.
- Luna’s marker recall is erratic, and one repetition per fixture cannot bound variance.
- Sonnet’s `finish_reason: length` guard prevents truncated output being mistaken for conservatism.
- The 67,890-character Whitman block and 14,572-character Hacker block are real.
- A drop mask cannot fix those shape failures.
- Splitting belongs to stage 3, and deterministic splitting should be tried before a model.
- “Do not automatically drop yet” is correct.

## Recommended replacement

1. Fix the instruments to run the real shared pipeline and include all 21 fixtures.
2. Add gold labels and negative controls for numeric/symbol-only content.
3. Evaluate structural deterministic rules—not the broad letterless regex—before a model.
4. Rerun Luna/Terra/Sonnet on the actual residual with matched repetitions and complete failure accounting.
5. Keep Luna detection-only until ordinary-page evidence exists.
6. Handle Whitman/Hacker separately in stage 3 with typed expected boundaries and RFC/code counterexamples.

No files were changed.