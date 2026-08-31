Verdict: **PROCEED-WITH-CHANGES.** The stage-2 fix works, but the instrument and several claims are not yet honest enough to justify “safe on this evidence.”

## Findings

1. **High — harmful additions are still scored as “helps.”**  
   [`corpus.mts:203`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/corpus.mts:203) sets `helped` from recovered characters, then [`:208`](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/corpus.mts:208) emits READ THEM only when `!helped`. I reproduced a common CSS-hidden mobile drawer containing 30 navigation items: un-hiding added 3,366 furniture characters and the runner classified it as `un-hide helps`. It printed only three snippets, without the warning.

   Therefore these claims are false:

   - “`gainedText` refuses to score additions.”
   - “the instrument could have detected a wide harm.”
   - The deleted ratio guard was replaced by a working qualitative guard.

   Every non-empty gain needs the warning. “Helps” must not be assigned until the gain is judged.

2. **Medium — `gainedText()` is neither a block comparison nor complete.**  
   It ignores all gains shorter than 40 characters and omits tables, captions, definition lists, generic containers, images and MathML. It also misses a newly added duplicate whenever the same text appears anywhere in stock, and it can double-count nested `li`/`blockquote`/paragraph structures.

   This already falsifies the reported number. The Constitution produces **96 additional stage-3 blocks**:

   - 45 `<p>`
   - 47 `<li>`
   - 4 `<h3>`

   `gainedText()` reports 94 because two new headings are below its floor. Thus [`260827ab-readability-repair-pass.md:90`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827ab-readability-repair-pass.md:90) cannot say “94 blocks” alongside “4 more `<h3>`.” It means “94 selected elements over 40 characters,” not blocks.

3. **Medium — the test does not prove stage 2 calls the helper.**  
   [`extract-unhide.test.ts:73`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/extract-unhide.test.ts:73) manually calls `unhideCollapsedSections`. Deleting the production call at [`extract.ts:262`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:262) leaves this entire test file green. Add one `runExtract()` assertion.

   The `charThreshold` is fine: I measured 2,196 characters in the stock arm and 3,660 after un-hiding, both comfortably above 500.

   The mutation claim is also inaccurate: the no-op, `[hidden]`, and `display:none` mutations are each caught by both a direct DOM assertion and a Readability assertion—not “exactly one assertion.”

## The six design questions

1. **Permanent removal versus restore-after-parse**

   The Wikipedia argument is sound for Wikipedia, but it does not justify deleting accessibility semantics globally.

   The strongest restore case is that extraction and accessibility are separate decisions. Temporarily removing the attribute lets Readability consider the node; restoring it preserves valid author decisions about decorative images, duplicated labels and visual-only furniture. Wikipedia is an exceptional broken pair created by Readability deleting one twin; repair that pair specifically.

   Blanket restoration is also wrong: restoring `aria-hidden` on the recovered Constitution regions would leave 39,355 visible characters absent from the accessibility tree. My recommendation is neither blanket policy:

   - Keep removal on recovered disclosure/content regions whose collapsed state no longer exists.
   - Restore it by default on leaf/decorative or duplicate nodes.
   - Handle Wikipedia-style fallback images only when their accessible MathML twin did not survive.

2. **Wikipedia accessibility**

   The checked-out tree now contains evidence absent from the pasted diff: after the real sanitiser there are 208 images, 188 with non-empty TeX `alt`, and `aria-hidden` changes 188→0. I reproduced that exactly.

   Standards support the accessibility-tree inference: `aria-hidden=true` excludes content, while a non-empty image `alt` supplies its accessible name. [WAI-ARIA](https://www.w3.org/TR/wai-aria-1.2/#aria-hidden), [HTML-AAM](https://www.w3.org/TR/html-aam-1.0/#el-img).

   What remains unproved is “audible” or “accessibility win.” Falsifiers are:

   - Browser accessibility inspection does not show 188 image nodes named by their `alt`.
   - VoiceOver/NVDA does not announce those names in ordinary reading mode.
   - The raw TeX proves unusable enough that “not silent” is not materially accessible.

   Safer wording: “restores non-empty accessible names to 188 retained formula images.”

3. **A page that breaks it**

   A CSS-hidden off-canvas mobile menu implemented as a plain `<div aria-hidden="true"><ul>…` inside the article shell. External CSS moves it off-screen; no `[hidden]` or inline `display:none` exists. Current code admits it.

   The corpus cannot judge this. It contains one positive content recovery and one attribute-only case, but no surviving hidden furniture case.

4. **`gainedText()`**

   False misses: short headings, duplicated text, text contained within a longer stock passage, and every omitted tag. False gains: slight reserialization/text changes and nested containers whose descendants are the true addition. It also shows only three console snippets and stores twelve, so it does not “print the blocks.”

5. **Test honesty**

   The behavioral assertions are sound and the threshold is not a problem. The dishonest part is the missing production-wiring test and the inaccurate mutation-count claim.

6. **Bare SVG**

   Deferring is correct. The documented casing analysis matches [`blocks.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:256), and changing what receives stable IDs is a separate stage-3 contract change. Recording the hole is better than silently bundling an unreviewed fix. Give it its own test and change.

Finally, the user-level “48,147 characters held in three accordions” is wrong: **48,147 is the inventory’s total dropped-character score; the three accordion bodies contain and recover 39,355 characters.**

Verification: all 15 fixture hashes match; I independently reproduced 13 byte-identical pages, Wikipedia’s 188 attributes/3,572 bytes, Constitution’s +39,355 characters, and `[hidden]` changing only arXiv by +95. The focused six-file run passed 157 tests. No files were edited.

