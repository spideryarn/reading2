The diagnosis is correct for the reported article, but I would not approve the rule unchanged. Two false-classification paths need closing first.

1. **High — the rule folds documented non-matter such as Key points and executive-summary lists.**  
   [plan:39](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/docs/plans/261024h-an-unlabelled-contents-list-folds-like-a-labelled-one.md:39) declares that any matching list is a contents list, contradicting [front-and-back-matter.md:42](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/docs/project/front-and-back-matter.md:42), which says Key points and executive summaries must never fold.

   Concrete failure:

   ```text
   Key points
   - What changed
   - Why it matters
   - What comes next

   ...article prose...

   ## What changed
   ## Why it matters
   ## What comes next
   ```

   This can be a substantive preview, not navigation. The draft implementation folds the three bullets as `contents`, leaving the “Key points” heading visible above a closed Contents stub. The same happens with an opening list of three headline claims later reused as section headings.

   `contentsExplained` is not an independent safeguard: it accepts on the same heading-match evidence at [matter.ts:742](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter.ts:742).

   Prefer structural evidence: the reported article’s entries each contain an internal link to the corresponding later heading ID. Since block splitting already rewrites those links to stable block IDs ([blocks.test.ts:553](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/tests/blocks.test.ts:553)), a run of three distinct links targeting later heading blocks is both safer and less sensitive to displayed numbering. At minimum, veto a run immediately under `Key points`, `Highlights`, `Significance`, `Executive summary`, or `Author summary`.

2. **High — an unlabelled TOC beginning “Abstract” or “Keywords” loses to the existing label rule.**  
   The exact-label candidates are proposed first at [matter-labels.ts:72](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter-labels.ts:72); the proposed run comes later at [matter-labels.ts:106](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter-labels.ts:106). `holdStretches` sorts only by start and drops the later overlapping candidate at [matter.ts:1299](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter.ts:1299).

   Concrete PDF-style contents:

   ```text
   Abstract
   Introduction
   Methods
   ```

   followed later by those three headings. The existing `Abstract` rule accepts `Abstract` plus `Introduction` as an abstract label and its one body block; the stronger three-entry contents candidate is then dropped as overlapping. I reproduced the result: the first two entries became an `abstract` stretch and no `contents` stretch survived.

   Merely proposing contents earlier is insufficient for model overlap: `combineMatter` explicitly chooses the model candidate over the free rule at [matter.ts:1393](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter.ts:1393). If an exact/linked contents run is meant to be stronger evidence than the model, that precedence must be encoded in both places.

3. **Medium — the proposed eval cannot establish safety because its negatives do not exercise the new predicate.**  
   The evidence promised at [plan:62](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/docs/plans/261024h-an-unlabelled-contents-list-folds-like-a-labelled-one.md:62) checks malformed TOCs, but not prose-like lists that satisfy every condition. The harness’s synthetic adversaries at [matter-eval.ts:353](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/scripts/matter-eval.ts:353) test prompt injection, not deterministic-rule false positives.

   Add at least:

   - `Key points` plus three exact later headings: must remain visible.
   - Three opening headline claims repeated as later headings: must remain visible.
   - An unlabelled TOC beginning `Abstract, Introduction, Methods`: must become one Contents stretch.

   The three existing corpora already had 100% union contents recall, so unchanged totals mainly show that none contains a new positive or adversarial negative.

4. **Medium — text equality is adequate for many web TOCs, but too strict for some PDF and decorated forms.**  
   [entryText at matter.ts:460](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter.ts:460) handles ordinary decimal section numbers, punctuation, dot leaders, and trailing decimal page numbers. Nested HTML lists are already separate blocks, including nested items ([blocks.test.ts:54](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/tests/blocks.test.ts:54)). Thus common Hugo and WordPress output should generally match; both generate lists of internal heading links. [Hugo’s documented markup](https://gohugo.io/methods/page/tableofcontents/) and the [WordPress TOC block](https://wordpress.com/support/wordpress-editor/blocks/table-of-contents-block/) confirm that shape. MediaWiki normally reproduces and numbers headings, also compatible with the basic normalization. [MediaWiki documentation](https://www.mediawiki.org/wiki/Toc).

   Real misses remain:

   - `Abstract iv` versus heading `Abstract`: Roman trailing pages are recognized by `ENTRY_PAGE` at [matter.ts:477](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter.ts:477), but `entryText` does not remove them.
   - `Chapter 1 Introduction` versus `Introduction`: `ENTRY_NUMBER` recognizes the prefix, but `entryText` does not.
   - Several entries flattened into one PDF block: the block-count rule cannot see three entries.
   - Entries with substantive suffixes such as `Introduction — 5 min read`.

   Worthwhile relaxations are Roman page numbers and `Part/Chapter/Section/Appendix/Annex` prefixes, but only when the remaining text exactly matches a later heading. Internal-link targets should allow arbitrary displayed numbering or trailing decoration. Do not adopt the labelled path’s prefix match, “number alone is evidence”, or 60% threshold without a label; those reopen the Key points failure.

   Ghost’s official approach uses Tocbot to create the list in client-side JavaScript, so it may never reach Readability at all; that is an extraction limitation, not something this rule can solve. [Ghost tutorial](https://ghost.org/tutorials/adding-table-of-contents/).

For the reported article itself, the rest of the pipeline is sound: blocks 3–15 fold successfully; the masthead echo affects block 0, the one-short-block rule cannot apply, `contentsCut` preserves the exact run, and the half-showing floor passes. An adjacent title/dateline/figure stretch does not itself cause trouble—overlap and precedence do.

`matter-labels.ts` is the right orchestration home because it is the free fallback when the model fails. Keeping the shared matcher beside `entryText` in `matter.ts` is reasonable. The simplest robust version is an internal-link-to-later-heading run; it fixes the reported case, covers genuinely unlabelled generated web TOCs, and avoids treating a bare summary list as navigation.