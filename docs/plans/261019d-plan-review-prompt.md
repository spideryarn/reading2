You are reviewing a plan before it is built, in the repo at the current directory (read-only review).

Plan: docs/plans/261019d-touch-screens-get-the-gutter-bar-and-narrower-prose-margins-ipad-included.md
Its predecessor (built, deployed): docs/plans/261018g-phone-portrait-gutter-icons-above-the-paragraph.md

Code it touches: src/web/styles/gutter.css (§ "a narrow screen and a finger", the `@media (max-width: 731px) and (hover: none)` block near the end, and the other `(hover: none)` / `(hover: hover)` rules in that file), src/web/styles/narrow-window.css (lines ~52-291, the `@media (max-width: 731px)` block with the nested `(hover: none)` pad tokens), src/web/styles/shell.css (the token defaults on `.reader`), src/web/styles/marginalia.css, src/web/styles/prose.css, src/web/styles/footnotes.css, src/web/layout.ts (fitMargin, proseAloneMaxPx), tests/gutter-phone-bar.test.ts, tests/helpers/stylesheets.ts. Stylesheet import order is in src/web/styles.css.

Please check, concretely:
1. Does lifting the width condition (bar + pads on every `(hover: none)` screen) break anything at widths > 731px that the phone never exercised? E.g. a mode band beside the prose, Marginalia's notes column and its positioning against the cell's right edge, the heading fold chevron, footnote gutters, the centred masthead/title rules that read --text-pad-l/--text-pad-r (narrow-window.css ~1300-1445), the `.blk-gutter` `right:` formula when the cell is wider than the 65ch measure, the chat card docking, any rule outside the 731 block that assumes --blk-gutter-x is 0.35rem.
2. Cascade: will a top-level `@media (hover: none) { .reader { ... } }` placed after the 731px block in narrow-window.css reliably beat both shell.css's defaults and the narrow `.reader { --text-pad-l: 0.9rem }`? Any other place that sets these tokens with higher specificity?
3. Any rule anywhere that keys off (max-width: 731px) and (hover: none) in JS (matchMedia) that would now disagree with the CSS?
4. Is the plan's reading of Greg's request right, and is there a simpler or better option it missed?
5. Test plan adequacy.

Write findings as P0/P1/P2 with file:line evidence. End with a one-line verdict: BUILD AS IS / BUILD WITH CHANGES / RETHINK.
