## Findings

1. **High — fixed:** the freshness hash ignored link targets. [src/matter-current.ts:89](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter-current.ts:89)

   A re-extraction could remove or retarget contents links while leaving block IDs, text and kinds unchanged. The old matter value would then remain “current,” preserving an obsolete fold or omitting a newly eligible one. I introduced the `m2` hash, covering the interpreted in-page anchor targets, while retaining the old `m1` calculation specifically for stored `matter/2` documents.

2. **Medium — fixed:** the original href regex treated non-anchor `href` attributes as navigation evidence. [src/matter-current.ts:67](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter-current.ts:67)

   A hostile page could provide three SVG `<image href="#spya-…">` elements targeting chosen heading IDs and have prose folded despite containing no navigable entry links. Extraction is now restricted to canonical serialized `<a>` elements and remains quote-aware when earlier attributes contain `>`.

3. **Medium — fixed:** entry text and link destinations were checked independently. [src/matter-labels.ts:167](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter-labels.ts:167)

   Three lines could name headings A/B/C while their links targeted D/E/F; both evidence sets passed independently. Each entry must now name the heading targeted by its own link, using the shared normalizer at [src/matter.ts:459](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter.ts:459).

4. **Medium — fixed:** fully linked “Key points,” “Highlights,” “Significance,” “Executive summary,” or “Author summary” lists were folded despite the documented “never folded” rule. [src/matter-labels.ts:123](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/matter-labels.ts:123)

   The former test covered only an unlinked Key points list. The rule now vetoes linked runs following those labels, including across empty separator blocks.

5. **Low/medium — wider issue, not changed:** an anchor wrapping a block-level entry is discarded before matter sees it. [src/blocks.ts:524](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/blocks.ts:524), [src/blocks.ts:1548](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/src/blocks.ts:1548)

   For `<a href="#one"><p>One</p></a>`, stage 3 stores only the `<p>`, so a genuine contents entry is missed and its wrapper link is also absent from the reading view. Correcting that needs a wider decision about stage-3 block representation.

Self-links do not qualify: a list item’s self-link targets its own earlier/non-heading block, so the later-heading requirement rejects it. The half-showing floor and `holdStretches` evidence checks limit the impact of hostile input but did not prevent findings 2–4.

## Version audit

The split is sound after the hash fix:

- New writes and rerun decisions require `matter/3` and the current `m2` hash.
- `matterSettled` and pipeline stamps require the exact current version.
- Owner and public reads both pass through `matterForReader`.
- Genuine `matter/2` documents remain readable using their original `m1` hash because `matter/3` added candidates without weakening any admission rule used by `matter/2`.
- The public DTO removes internal matter metadata only after that read gate.
- Exports carry the raw artifact rather than independently interpreting it.
- I found no fleet/admin view that folds a matter document itself.

## Changes and verification

I updated the implementation, tests, and [front-and-back-matter.md](/var/tmp/spideryarn-worktrees/fbjk0xw5-article-toc/docs/project/front-and-back-matter.md:56). The new integration tests exercise actual `splitIntoBlocks` output, including single-quoted/entity-encoded source hrefs, preceding attributes containing `>`, nested inline content, SVG hrefs, self-links, cross-wired targets, and fully linked Key points.

Verification:

- Focused matter/public DTO suite: **101 tests passed**
- All four TypeScript projects: passed
- Biome on touched files: no errors or warnings; only existing complexity advisories
- `git diff --check`: passed
- The broader unit run encountered unrelated sandbox-dependent subprocess/FIFO/account-check failures, so it was not counted as a green full-suite result.

No commit was made.