# Code review: author titles in prose cards

1. **P2 — `src/sanitize-policy.ts:701`: the hook inferred an accessible name
   from descendants before DOMPurify had sanitised them, and HTML-only
   `tagName` comparisons missed SVG links. Fixed.** A later-removed `<script>`
   or `<input alt>` could make an eventually empty link look named, so moving
   `title` discarded its only accessible name. Blank or broken ARIA references
   had the same result. `moveAuthorTitle` now only moves the attribute;
   `sanitizeArticleHtml` makes the accessibility decision over the completed
   clean fragment, using `localName`, before serialising it. Both bindings call
   that function. Red-first final-output tests cover removed children, SVG,
   blank/broken ARIA, byte equality, idempotence and second-pass attribute
   order. The no-title fast path keeps the allowlist probe performance.

2. **P2 — `src/web/ProseHoverCard.tsx:469`: one xref inside a titled ancestor
   suppressed the author's card for every other word in that ancestor. Fixed.**
   The xref is now a shadowing delegated-selector target which `read` declines
   before walking upward. The xref still belongs to BlockLinkCard, while
   ordinary words beside it retain the author title. The regression test fails
   on the committed implementation and passes now; the xref integration suite
   also covers merged marks, pointer/focus ownership and touch behavior.

3. **P3 — `src/web/author-title.ts:33`: clipping by UTF-16 code unit could split
   a surrogate pair. Fixed.** Clipping now counts Unicode code points with
   `Array.from`. The red-first test puts an emoji across the 300-character
   boundary. Relative-address comparison and fragment-only links are pinned in
   the same suite.

No P0 or P1 finding. I found no further regression in the existing term,
citation, quote, note, ordinary-link, cross-reference, touch, keyboard or chat
paths. `.prose [data-author-title]` intentionally confines ancestor lookup to
article prose; the unchanged `.chat-turn` host continues to serve only its
existing chat-link selectors. `openDelay`, section dividers and the dialog label
compose correctly when the author section is present. The security-map row,
tooltips documentation, block-key compatibility and bibliography fallback are
accurate.

Verification:

- The requested ten-file Vitest command passes.
- `node --import tsx scripts/typecheck.ts` passes all three TypeScript projects.
  The exact `npm run typecheck` wrapper reaches the same script but cannot open
  `tsx`'s Unix socket in this sandbox (`listen EPERM /tmp/tsx-1000/14.pipe`).
- `tests/doc-links.test.ts`: 18 passed.
- Additional hover/xref/touch integration run: 6 files, 161 passed.

Files edited in review:

- `src/sanitize-policy.ts`
- `src/sanitize.ts`
- `src/web/sanitize.ts`
- `src/web/author-title.ts`
- `src/web/ProseHoverCard.tsx`
- `tests/author-title.test.ts`
- `tests/author-title-card.test.tsx`
- `tests/sanitize-client.test.ts`
- `docs/plans/261018n-an-article-s-own-title-attributes-shown-in-our-card-marked-as-the-author-s.md`
- `docs/postmortems/261018c-a-pre-order-hook-cannot-claim-its-descendants-survived.md`
- `docs/plans/261018n-author-title-code-review-sol.md`

VERDICT: ship after fixes (applied)
