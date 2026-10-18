You are reviewing a plan before it is built, in the Spideryarn repo (this working tree). Read-only: do not edit files.

The plan: docs/plans/261018n-an-article-s-own-title-attributes-shown-in-our-card-marked-as-the-author-s.md

Context to read:
- src/sanitize-policy.ts (the one sanitiser policy, a security defence; both bindings share it: src/sanitize.ts server, src/web/sanitize.ts browser)
- tests/sanitize-allowlist.test.ts, tests/sanitize-client.test.ts, tests/sanitize.test.ts
- src/web/external-links.ts (the precedent for a presentation pass outside the policy) and src/web/maths.ts around line 284 (re-sanitises changed blocks)
- src/web/ProseHoverCard.tsx (`read`, the `useHoverCard` selector, the card body, `LinkCard`)
- src/bibliography.ts `anchorsOf` (reads `title` off a stored block's links)
- docs/project/security-map.md, docs/project/fonts.md, docs/project/tooltips.md
- docs/user-feedback/questions/q-z2c269.md (the question Greg answered, and options A/B/C)

Greg's permission covers this one sanitiser change. Please check:
1. Is renaming `title` -> `data-author-title` inside the policy hook safe? Any mXSS, DOM-clobbering, or forgery consequence, given ARTICLE_DATA_ATTRS's "kept names" rule and the test that pins which kept names browser code may read? Is the "forging it gains nothing over title" argument right?
2. Idempotence and server/client byte-equality: does afterSanitizeAttributes' order (attribute removal/adding, aria-label) keep a second pass a no-op and both bindings identical? Any element types (SVG, MathML, iframe, img) where moving `title` is wrong?
3. Is not bumping SANITIZER_VERSION right, by the rule in its comment?
4. Any other reader of `title` on stored or rendered block html that the plan missed (server or browser)? Grep for it.
5. Is the card design (selector widening to `.prose [data-author-title]`, filter heuristics, placement above the link half) sound with useHoverCard's delegation, focus, and touch rules? Any interaction that breaks an existing card (terms, cites, quotes, notes, xrefs, BlockLinkCard)?
6. Is there a simpler version that keeps the words and marks them as the author's?

Answer with numbered findings, each with severity (P0/P1/P2/P3), file:line evidence, and a concrete fix. End with a one-line verdict: "VERDICT: proceed", "VERDICT: proceed with fixes", or "VERDICT: rethink".
