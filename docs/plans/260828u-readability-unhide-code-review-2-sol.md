Verdict: **PROCEED-WITH-CHANGES.** The helper and wiring test are fixed. The instrument is not.

## Findings

1. **High — Finding 1 survives through the duplicate blind spot.**

I built an article containing a hidden second copy of an existing 1,700-character paragraph. Un-hiding admitted it:

- Article text increased by 1,700 characters.
- Stock and un-hidden `droppedChars` both remained 0.
- `gainedText()` returned 0 because the text already existed.
- No READ THEM warning or snippets would appear.
- The summary would say “adds text on 0 … loses text on 0.”

That is the third instance. The design is wrong, not merely the `!helped` condition. The blind spot documented at [corpus.mts:159](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/corpus.mts:159) bypasses the supposedly unconditional warning at [corpus.mts:246](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/corpus.mts:246).

Leaving this is not defensible. An `aria-hidden` accessibility duplicate is exactly the likely harm. Use multiplicity, or at minimum warn whenever `articleHtml` changed but no passage was identified.

2. **The de-nesting implementation is mechanically correct.**

On the Constitution:

- 94 elements qualify before de-nesting.
- 76 are reported.
- All 18 suppressed elements are nested `li > li`.
- No siblings are suppressed.

DOM query order puts ancestors before descendants, and `contains()` cannot match siblings. So 94 → 76 is explained, not accidental.

However, 76 means “topmost selected containers,” not 76 separate semantic passages. The console also prints only the first 110 characters of each container, so suppressed child items may only be visible in the JSON. The stale 94 claim remains in [corpus.mts:152](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/corpus.mts:152).

3. **The `runExtract` test is sound.**

It creates a unique empty directory, invokes the production entry point, and reads the actual output file. “Sentence 3” cannot enter through the title or template. The observed red state with the production call removed is good evidence. See [extract-unhide.test.ts:119](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/extract-unhide.test.ts:119).

4. **Deferring restore-after-parse is acceptable.**

I would not block shipping specifically on that design. Restoring `aria-hidden` would preserve accessibility semantics, but it would not remove an admitted drawer from the visible extracted article. Fixing that requires an inclusion rule or post-filter, not merely restoring the attribute.

The current bundle is still not ready because of the duplicate warning bypass, not because restore-after-parse was deferred.

## Prose still overstating

Important remaining cases:

- The plan says both “small accessibility win” and “not an accessibility win” in the same passage: [260827ab-readability-repair-pass.md:82](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827ab-readability-repair-pass.md:82).
- It still says “audible” and “could have detected a wide harm”: [260827ab-readability-repair-pass.md:628](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827ab-readability-repair-pass.md:628).
- The source comment still asserts a screen-reader user “gets silence,” which was not tested: [extract.ts:180](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:180).
- “Text added inside an existing paragraph is invisible” is false. I reproduced it being detected; the real limitation is that the entire paragraph is reported rather than the inserted text: [corpus.mts:159](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/corpus.mts:159).
- “The added text is printed above” is false because only ten 110-character prefixes are printed, and duplicates can be omitted completely: [corpus.mts:256](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/corpus.mts:256).
- “0 of its 188 formulas” is misleading: the `<math>` elements disappear, but 188 fallback formula images remain: [content-extraction.md:100](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/content-extraction.md:100).
- The plan also retains stale “nothing changed,” 14-page, four-instrument-bugs, and “1 helped” wording.

Verification: focused tests passed, 12/12. The corpus completed all calculations and reproduced 76 passages and the documented totals; it then failed only when the read-only sandbox prevented writing `extraction-corpus.json`. No files were edited.