## Verdict

Not ready as-is. The Substack case works, but I found one high-severity silent classification failure and three medium regressions/gaps.

## Findings

1. **High — callouts containing loose text silently become ordinary prose.**  
   [src/callouts.ts:93](/home/greg/code/spideryarn2/src/callouts.ts:93), [src/callouts.ts:238](/home/greg/code/spideryarn2/src/callouts.ts:238)

   Input:

   ```html
   <div class="callout">Loose words without a p wrapper.</div>
   ```

   Only the container is stamped. Readability creates a new `<p>` for the text, then unwraps the `<div>`. The new paragraph never receives the stamp. I ran the real Readability → DOMPurify → `splitIntoBlocks` sequence; it produces:

   ```html
   <p>Loose words without a p wrapper.</p>
   ```

   with `kind: "text"`. The same happens with an inline-only child such as `<span>…</span>`.

   Fix: before Readability, materialise and stamp the same phrasing runs it will turn into paragraphs, or preserve the stamp on surviving inline content and let stage 3 recognise a stamped descendant. Add text-only and span-only end-to-end tests.

2. **Medium — the navigation guard rejects explicitly declared callouts.**  
   [src/callouts.ts:158](/home/greg/code/spideryarn2/src/callouts.ts:158), [src/callouts.ts:229](/home/greg/code/spideryarn2/src/callouts.ts:229)

   Despite the comment saying the guard exists “for `<aside>` and nothing else”, it runs for every selector. This explicit callout is skipped:

   ```html
   <div data-callout="true">
     <p><a href="/warning">Read this essential warning</a></p>
   </div>
   ```

   Its link density is 1, so the authoritative `data-callout` signal loses to a heuristic intended for ambiguous asides.

   The density calculation also differs materially from Readability: Readability weights fragment links at 0.3, while [src/callouts.ts:187](/home/greg/code/spideryarn2/src/callouts.ts:187) counts them fully. A short editorial `<aside>See <a href="#s4">Section 4</a>.</aside>` can therefore be rejected as navigation.

   Fix: apply `isNavigation` only when the winning shape is the broad `"aside"` signal, and reproduce Readability’s fragment-link coefficient. Test both cases.

3. **Medium — the new kind silently removes callout-only names from dictation vocabulary.**  
   [src/vocabulary.ts:241](/home/greg/code/spideryarn2/src/vocabulary.ts:241)

   `proseOf` deliberately accepts only `kind === "text"`. After this change, an article that mentions “Persistent Astra” repeatedly only inside callouts contributes none of those mentions to the article’s dictation vocabulary. I confirmed `proseOf([{kind:"callout", …}, {kind:"text", …}])` returns only the ordinary text.

   Fix: include `"callout"` in `proseOf`, with a regression test. This is also evidence against the claim that no downstream code reads `kind`.

4. **Medium — Docusaurus admonitions are missed.**  
   [src/callouts.ts:73](/home/greg/code/spideryarn2/src/callouts.ts:73)

   Docusaurus uses the exact class token `theme-admonition`, not `admonition`. The current selector recognises zero containers for:

   ```html
   <div class="theme-admonition theme-admonition-warning alert alert--warning">
     <p>Do not delete this token.</p>
   </div>
   ```

   That class is documented in [Docusaurus’s official class map](https://docusaurus.io/docs/3.9.2/styling-layout).

   Fix: add `[class~="theme-admonition"]` and an end-to-end test. WordPress’s `wp-block-pullquote` is technically also missed, but its official markup contains a real `<blockquote>`, so it already becomes a quote and needs no new selector ([WordPress markup](https://developer.wordpress.org/block-editor/reference-guides/core-blocks/core-blocks-text/core-block-pullquote/)).

5. **Low — callout positioning is physically left-sided, not direction-aware.**  
   [src/web/styles.css:1270](/home/greg/code/spideryarn2/src/web/styles.css:1270)

   An RTL article still receives `padding-left` and `left: 0`, placing the gutter and mark on the wrong side.

   Fix: use `padding-inline-start` and `inset-inline-start`. Consider `open-quote` rather than a fixed U+201C if locale-specific quote glyphs matter.

6. **Minor — the migration comment says “row by row”, but writes are batched and transactional.**  
   [src/db/schema.ts:790](/home/greg/code/spideryarn2/src/db/schema.ts:790)

   Imports insert all blocks in one statement at [src/store/import.ts:1078](/home/greg/code/spideryarn2/src/store/import.ts:1078), inside the transaction opened at [src/store/import.ts:1397](/home/greg/code/spideryarn2/src/store/import.ts:1397). Pipeline writes are similarly batched at [src/store/artifacts-pg.ts:1120](/home/greg/code/spideryarn2/src/store/artifacts-pg.ts:1120).

   Fix the comment to say the batch statement fails and the whole transaction rolls back.

## Specific questions

- **Stamp survival:** stamped existing elements survive `_setNodeTag`; the broken path is Readability creating a fresh paragraph from loose phrasing content. I found no path that moves a valid stamp onto unrelated sibling prose.
- **Scrub/security:** the document-rooted scrub reaches `<html>`, `<body>`, and nested template fragments. The PDF reasoning is sound: [src/pdf-read.ts:588](/home/greg/code/spideryarn2/src/pdf-read.ts:588) escapes all record text and [src/pdf-read.ts:637](/home/greg/code/spideryarn2/src/pdf-read.ts:637) chooses tags and attributes from fixed code.
- **Worst forgery:** more than styling. A forged stamp reaching stage 3 changes `kind`; if its text duplicates body prose, [src/blocks.ts:233](/home/greg/code/spideryarn2/src/blocks.ts:233) can also set `gistable: false`, removing it from search, embedding and navigable rows. The supported hostile-HTML path scrubs this, so it is not currently exploitable through normal ingestion.
- **`aside`:** “already rendered as prose, therefore not worse” is not strictly sound. Classification can affect gistability and downstream kind consumers, and a quote mark can misrepresent an author bio, sponsor box or other low-link sidebar. Bare `aside` remains the highest-false-positive selector.
- **`describeBlock`:** preserving heading/quote/media kinds is structurally correct, but it proves calloutness is orthogonal to `kind`: the heading loses all callout presentation. For the narrow Substack paragraph case, `BlockKind` is adequate. For the broad admonition/aside promise, a separate `presentation?: "callout"` field is cleaner. Do not reuse `treatment`; that field governs argument-versus-supplement policy.
- **Pull-quote rule and `proseText`:** excluding callouts fixes the self-match and is reasonable. It only stops detecting duplication between two callouts, which is a minor limitation. A per-element “compare against every other paragraph” implementation would be more exact but probably not worth its complexity.
- **Migration:** the normal deploy applies migrations before pushing code at [scripts/deploy.ts:1325](/home/greg/code/spideryarn2/scripts/deploy.ts:1325). Migration-first is backward-compatible. Code-first with migrations skipped fails loudly and transactionally when a callout block is written; it does not leave a partial revision.
- **Nesting:** document-order reliance is valid. A matched descendant sees the stamped ancestor and is skipped. An element matching several selector arms appears only once in `querySelectorAll`.
- **CSS:** `pointer-events: none` prevents the mark stealing clicks; comment marks remain ordinary inline content; enlarge controls do not land in callout text blocks. The caption cascade ordering is correct. RTL is the concrete CSS defect; one-line overlap and print need browser evidence rather than a code-only claim.
- **Existing articles:** the documentation is honest, but this is a release requirement: deploying code and migration alone does not fix `/read/openai-huggingface`. Stage 2 must be rerun after the migration before the named user-visible problem is actually resolved.

## Missing tests

A plausible wrong implementation still passes the current suite. Add tests for:

- loose text and inline-only callout containers;
- an explicit, link-heavy `data-callout`;
- a short `<aside>` with a fragment citation;
- `theme-admonition`;
- unique callout remains `gistable: true`;
- body-duplicating callout becomes `gistable: false`;
- previous block ID is carried across introducing the stamp;
- `proseOf` includes callouts.

The current real-pipeline tests are otherwise the right shape, and the template/root scrub and nested-container handling are fine.

Verification note: the real in-memory pipeline probes reproduced findings 1–3. Main and web TypeScript projects pass. The test project currently has two unrelated diagram-test type errors. Vitest itself could not start in this read-only review sandbox because Vite attempted to create cache directories.