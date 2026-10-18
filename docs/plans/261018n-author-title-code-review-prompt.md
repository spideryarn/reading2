You are reviewing code before it is pushed, in the Spideryarn repo (this working tree). You may fix what you find inside this change's scope; report anything wider for the author to decide.

The change is commit HEAD (diff at docs/plans/261018n-author-title-code-review.diff). Plan, with your earlier plan review and how each finding was handled: docs/plans/261018n-an-article-s-own-title-attributes-shown-in-our-card-marked-as-the-author-s.md and docs/plans/261018n-author-title-plan-review-sol.md.

In short: the shared sanitiser policy (src/sanitize-policy.ts, a security defence; Greg approved this one change) now moves an article's `title` onto `data-author-title` (not on iframes), adds aria-label for an unnamed link / alt-less image and aria-description on abbr; src/blocks.ts emptyKey treats title and data-author-title as one; src/bibliography.ts anchorsOf reads either; src/web/ProseHoverCard.tsx shows the words as a "from the article" section, filtered by src/web/author-title.ts.

Please check, with evidence:
1. Correctness and security of `moveAuthorTitle` in DOMPurify's afterSanitizeAttributes: idempotence, server/client byte equality, attribute order on a second pass, behaviour when DOMPurify later removes the element or its children (does `hasAName`'s textContent/querySelector read pre-sanitised children, and could that misjudge?), SVG/MathML namespaces (tagName casing: is `el.tagName === "A"` right for an SVG `<a>`?).
2. ProseHoverCard: the `read` change, selector widening, openDelay, `divided` props, label; any regression for terms, citations, quotes, notes, links, xrefs, touch (`tapSelector`), keyboard focus, chat turns (`.chat-turn` host). Does `el.closest(".prose [data-author-title]")` behave as intended?
3. author-title.ts: the two comparators and clipping; edge cases (surrogate pairs at the clip, empty text, relative hrefs, fragment-only hrefs like "#spya-…" whose path is the article's own).
4. Tests: do they prove what they claim (would they go red without the code)? Missing cases?
5. Docs: security-map.md row, tooltips.md, comments — accurate?

Run the relevant tests: npx vitest run tests/author-title.test.ts tests/author-title-card.test.tsx tests/sanitize.test.ts tests/sanitize-client.test.ts tests/sanitize-allowlist.test.ts tests/empty-blocks-keep-their-ids.test.ts tests/bibliography.test.ts tests/citation-hover-card.test.tsx tests/note-preview-card.test.tsx tests/quote-hover-card.test.tsx and npm run typecheck.

Write numbered findings (P0–P3, file:line, what you changed if anything), then list the files you edited, and end with one line: "VERDICT: ship", "VERDICT: ship after fixes (applied)", or "VERDICT: do not ship".
