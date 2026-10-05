# Derived instructions must participate in the request fingerprint

Caught during the code review of [261005b](../plans/261005b-summary-length-follows-the-length-of-the-piece.md),
before the candidate reached readers. Nothing reached a reader. Commit `de2eb5bb9` introduced
Fuller's length bands while retaining a fingerprint that covered the rendered article and the
profile-free user message. The band could change without that fingerprint changing.

## The reproduction

The real `splitIntoBlocks` produces these two supported inputs:

- One `<pre id="spya-aaaaaa">` containing 2,498 repetitions of `word`, followed by
  `\n\nspya-bbbbbb: word`: one block, **2,500 words**, standard band.
- A `<pre id="spya-aaaaaa">` containing those same 2,498 words, followed by
  `<p id="spya-bbbbbb">word</p>`: two blocks, **2,499 words**, short band.

With title `Test`, both serialize to identical `articleWithIds` bytes and both originally return
fingerprint **`9559c0b0f2b5a062`**. Fuller's LENGTH instructions differ. A stored summary from one
therefore appears current against the other. The regression belongs in
[`tests/simple-summary.test.ts`](../../tests/simple-summary.test.ts), using the splitter
rather than invented block counts.

## The class: derived instructions outside the request fingerprint

The mistaken assumption was that a setting derived from article blocks was necessarily derived
from their serialized request bytes. [`articleWithIds`](../../src/article-prompt.ts) joins blocks
with blank lines and an id prefix; a code block can contain that same prefix. Serialization loses
the distinction between one block and two. The word counts retain it.

Before banding, the two inputs sent the same system instructions as well as the same article
bytes. The new dependency made the existing serialization ambiguity relevant to instruction
freshness. The comment beside generation's band lookup asserted that a band moved only when
`sourceHash` did; the reproduction disproves that assertion without corrupting stored counts.

## Why the existing checks stayed green

The length tests pinned thresholds and prompt content, and the request tests checked selection
from evidence blocks. They did not compare two real splitter outputs that shared rendered bytes
but selected different instructions. Prompt compatibility hashes also passed: this defect changes
which prompt is selected, not the contents of each prompt.

## The fix that preserves the old contract

Include the selected band in Summary's current request fingerprint. Share band selection between
generation and fingerprinting, using the splitter's exact count formula on each block's text.
The existing `wordCount` helper trims indentation preserved in code blocks and would change the
band at a threshold; an indented-code regression also covers that boundary. Narrow Postgres
fingerprint reads already carry text and treatment, so they need no additional column.

Keep the original fingerprint algorithm for stored `simple-prompt/1` through `/8` summaries.
Staleness and the pipeline's expected stamp must select the algorithm using the stored prompt
version, including the generic stamp's `simple/2` fallback for rows without a prompt version.
Otherwise a fingerprint correction would make every old summary stale and let an
unforced job rewrite it, violating the existing promise that prompt updates alone do not rewrite
stored summaries. Metadata may still compare against the current prompt because that check is
explicitly about being up to date.

## Countermeasures, ranked by ease against value

1. **A regression at the real input boundary**: the two splitter outputs above must choose
   different current fingerprints. This is cheap, needs neither database nor model, and exposes
   the exact incident shape. Also pin legacy hash and skip compatibility; fixing freshness must
   not introduce paid rewrites of old summaries.
2. **Audit all derived request settings when changing a prompt builder.** Check the complete
   request, including selected system instructions, against the inputs its fingerprint reads.
   This costs a small review step and applies beyond word-count bands.
3. **Replace the shared article serialization everywhere** — rejected for this review. It would
   alter many prompt and cache prefixes, expanding a Summary correction into a pipeline-wide
   migration. Covering Summary's derived instruction closes this defect without that change.

Up: [Postmortems](../project/postmortems.md)
