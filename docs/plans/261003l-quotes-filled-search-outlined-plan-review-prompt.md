You are reviewing a PLAN, read-only. Do not edit any file.

Plan: docs/plans/261003l-quotes-filled-like-a-highlighter-pen-and-search-hits-outlined.md

It swaps two marks in the article prose: quotes become a filled highlighter mark, search hits become an outline. Read the plan, then the code it rests on:
- src/web/styles/annotations.css (mark.cmt[data-colour], mark.hit, mark.hit[data-wash], the quote strokes section, stacked hues, the pressed rules)
- src/web/annotate.ts (where data-wash, data-quote, data-quote-start/end, --hit-a, --quote-a, data-hues are written)
- styles/tokens.css and src/web/styles/tokens.css (--quote-stroke-rgb, --hl-*, --hit-wash-rgb, both themes)
- src/web/styles/spine.css (.spine-quote)
- src/sanitize-policy.ts (FORBID_ATTR), tests/quote-stroke-fade.test.ts, tests/annotate.test.ts
- docs/project/quotes.md section "Not yellow", docs/project/colour-scales.md, docs/project/search.md

Questions, in order of importance:
1. Is anything in the plan false about the current code? Trace it; do not trust comments.
2. CSS correctness: will the proposed rules do what the plan says? In particular: inherited custom properties (--h0 is set on td.text.has-hit as well as on marks: can a mark without data-hues inherit a cell's --h0?); box-decoration-break slice vs clone with the hue band and with box-shadow edges and inset caps; specificity and source order between mark.cmt[data-colour] rules, mark.hit[data-quote], mark.hit[data-wash] and their pressed variants; a box-shadow top edge on inline fragments overlapping the line above.
3. What depends on the current split that the plan misses? Search for every reader of data-quote, data-wash, data-hit-open, --quote-stroke-rgb, --hit-wash-rgb, and every doc or reader-facing string that says quotes are outlined or search is filled.
4. Is the teal hue argument sound against the reader highlight tokens AND the categorical search palette in styles/colourscales.css (which becomes a stroke colour)? Is there a better gap?
5. Is carrying priority as fill strength in two tiers (0.30 and 0.42 times --quote-a) sound, and is the proposed contrast test the right one?
6. Anything simpler that gets the same result.

Answer with numbered findings, each marked P0/P1/P2, each with file:line evidence, and end with one line: VERDICT: build as planned / build after changes / do not build.
