You are reviewing a small plan in the Spideryarn repo (read-only). Read
docs/plans/261003f-authors-outside-links-to-find-more-about-each.md, then the code it touches:
src/web/AuthorNames.tsx, src/web/Metadata.tsx (the Authors section near line 980), src/web/Masthead.tsx
(around line 210), src/web/Tooltip.tsx (the `interactive` prop), docs/project/tooltips.md
§ "A card the pointer can enter", tests/masthead-authors.test.tsx, and the prior plan
docs/plans/260929d-authors-and-affiliations-at-import-shown-and-linked.md.

Question: is this the right simplest version of the reader's request (quoted at the top of the plan),
and will the design work? Look especially for: problems putting links inside the masthead name card
(interactive tooltip around a trigger that is itself a Link; nested focus; touch behaviour), URL
construction/encoding pitfalls with Google Scholar's author: operator (names with quotes, initials,
diacritics, very long affiliations), privacy/referrer, anything the plan claims that is false, and
anything a simpler or clearly better option would do. Also check the conclusion: is deferring the
Citations-band placement and the in-app model lookup reasonable?

Answer with numbered findings, each with a severity (P0-P3), the evidence (file:line), and a
concrete fix. Say plainly if you find nothing serious.
