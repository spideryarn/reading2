The focused suites pass: 140/140 tests. The following gaps remain.

1. **High — formatting is lost when the excerpt lies wholly inside one inline element.** [src/web/excerpt-html.ts:133](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:133), [src/web/excerpt-html.ts:142](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:142)

   `Range.cloneContents()` does not include a shared ancestor. For `<em>important words</em>`, extracting exactly `important words` returns plain text, not `<em>`. The same affects `strong`, `sub`, `code`, and nested combinations—precisely the formatting this feature promises.

   Suggested fix: walk the original tree while intersecting it with the range, recreating allowed ancestors as well as selected descendants. Alternatively, restore the shared allowed ancestor chain around the cloned fragment. Add tests for excerpts wholly contained by one and several nested formatting elements.

2. **High — authored MathML can carry IDs, links, names, and allowed `data-spya-*` attributes into the excerpt.** [src/web/excerpt-html.ts:219](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:219), [src/sanitize-policy.ts:263](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/sanitize-policy.ts:263)

   `<math>` is cloned recursively with all attributes. The final policy deliberately preserves `id`, safe `href`, `name`, and selected reserved data attributes. I reproduced:

   ```html
   <math id="spya-aaaaaa" data-spya-pdf-figure="forged">
     <mtext><a href="https://evil.test/x" name="n">target</a></mtext>
   </math>
   ```

   All four addressing attributes survived `excerptHtml`. This can duplicate a block ID, misdirect ID lookup, or put an active link inside a row button. Temml output receives the address check in `maths.ts`; authored MathML does not.

   Suggested fix: recursively strip at least `id`, `name`, `href`, `xlink:href`, every `data-*`, and focus/interaction attributes from retained MathML before final sanitization. Add a hostile authored-MathML regression test.

   I did not find a separate mutation-XSS path: parsing and final sanitization happen in the rendering engine before React reparses the result, and event handlers/style are removed. Keeping the trusted renderer function and sanitized source HTML under the private symbol is also not an attacker-controlled execution path.

3. **Medium — the API discards occurrence information that several stage-2 callers already possess.** [src/web/excerpt-html.ts:127](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:127), [src/web/search-hits.ts:105](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/search-hits.ts:105)

   The claim that no caller has an offset in the relevant space is false for `Found` records and reader selections. Search, Ideas, Timeline, comments, and highlights can identify a rendered-text occurrence. Given:

   ```html
   <em>same words</em> … <strong>same words</strong>
   ```

   a highlight or search hit on the second occurrence is drawn from the first. Quotes may deliberately use the first occurrence, but that rule should not be imposed on every artifact.

   Suggested fix: accept an optional typed location such as `{ space: "drawn", near }` or an occurrence ordinal. Use rendered offsets for `Found` and reader anchors; retain first-occurrence behavior only for callers that genuinely lack placement data.

4. **Medium — the provider-only component silently cannot format “where you left off.”** [src/web/Excerpt.tsx:22](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/Excerpt.tsx:22), [src/web/Metadata.tsx:1349](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/Metadata.tsx:1349), [src/web/article/ArticlePage.tsx:477](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/article/ArticlePage.tsx:477)

   Metadata is rendered outside `BlockLinkProvider`. Consequently `useBlockLinks()` returns `null` and `<Excerpt>` returns the original plain string, including raw TeX. The block is already available as `lastRead`.

   Suggested fix: split out a presentational excerpt component that accepts `block` directly, with the current contextual component as a wrapper. Use the direct form in Metadata and BlockLinkCard. This also removes BlockLinkCard’s duplicated HTML-sink implementation and is the main simplification I recommend.

5. **Medium — matching sees text that output filtering later deletes.** [src/web/excerpt-html.ts:125](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:125), [src/web/excerpt-html.ts:225](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:225)

   `textNodes` includes descendants of `DROP` elements, notably retained SVG. For:

   ```html
   <em>before</em><svg><text>label</text></svg><strong>after</strong>
   ```

   the words `before label after` match, but the returned excerpt is `beforeafter`; because matching succeeded, the plain-text fallback is not used.

   Suggested fix: construct the matching projection with the same drop/unwrap/boundary rules used to emit output, or verify the emitted text still corresponds to the requested range and return `null` otherwise.

6. **Medium — the long-list cost is understated and `useMemo` does not share work between rows.** [docs/plans/261009k-excerpts-keep-maths-and-formatting.md:125](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/docs/plans/261009k-excerpts-keep-maths-and-formatting.md:125), [src/web/Excerpt.tsx:25](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/Excerpt.tsx:25)

   One excerpt parses during `cutFrom`, again during `finish`, again in DOMPurify, and again at the React sink; math or a failed source-space pass adds further parses. `useMemo` only protects one mounted row. A local jsdom stress run over 300 ordinary excerpts took about 1.7 seconds—not a browser benchmark, but enough to reject the unmeasured “few hundred paragraphs” assumption.

   Suggested fix: benchmark Search in Chrome before rollout. Cache final results across component instances with a `WeakMap<Block, …>`, and consider caching each block’s parsed source/drawn projections. Quotes’ 60–120 rows are less concerning; Search’s hundreds are the real risk.

7. **Low — retaining `<q>` conflicts with callers that already supply quotation semantics or punctuation.** [src/web/excerpt-html.ts:52](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:52), [src/web/IllustratedView.tsx:766](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/IllustratedView.tsx:766), [src/web/SkimPanel.tsx:846](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/SkimPanel.tsx:846)

   A retained source `<q>` can become nested inside Illustrated’s `<q>`, or sit between Skim’s explicit curly quotation marks. Browsers generate punctuation for `<q>`, producing doubled or nested quotation marks.

   Suggested fix: unwrap source `<q>` like links. The caller already establishes that the displayed passage is a quotation.

8. **Low — the Marginalia rollout lacks the containing block ID, and “question notes” is ambiguous.** [src/web/marginalia/notes.ts:61](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/marginalia/notes.ts:61), [src/web/marginalia/MarginaliaColumn.tsx:80](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/marginalia/MarginaliaColumn.tsx:80), [docs/plans/261009k-excerpts-keep-maths-and-formatting.md:97](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/docs/plans/261009k-excerpts-keep-maths-and-formatting.md:97)

   FAQ and Timeline note items contain quotes but no block ID; the map key holding that ID is discarded before `MarginNotesSlot`. Conversely, `{ kind: "question", text }` is model-written text and must remain a string. Only an asked-question anchor is an article excerpt.

   Suggested fix: pass the containing `blockId` into `MarginNotesSlot`, convert FAQ/Timeline quotes and asked-question anchors, and explicitly exclude the structural question note.

9. **Low — fallback rendering can change literal TeX from a stale code excerpt into maths.** [src/web/excerpt-html.ts:150](/var/tmp/spideryarn-worktrees/fbpqae7m-excerpt-formatting/src/web/excerpt-html.ts:150)

   When placement succeeds, `MATHS_SKIP_TAGS` preserves `\(...\)` inside `<code>`. If an older code quote no longer locates, the fallback has lost that context and renders the same characters as maths.

   Suggested fix: make math fallback opt-in by artifact/source type, or explicitly accept and test this behavior. Unknown blocks correctly remain unchanged.

The dual pre-maths/drawn-space design is justified; a TeX-only solution would not preserve formatting. The safer simplification is one range-aware projection walker plus a block-accepting presentational component, rather than clone-then-filter and a provider-only component.

proceed with changes