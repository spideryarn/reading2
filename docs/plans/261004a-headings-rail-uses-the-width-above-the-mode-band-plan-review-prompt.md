You are reviewing a plan, read-only, in the Spideryarn repo (this worktree). Do not edit files.

The plan: docs/plans/261004a-headings-rail-uses-the-width-above-the-mode-band.md

Read it, then read the code it leans on and check its claims against the code rather than its
prose: src/web/styles/shell.css (`.reader`, `.masthead`, `.controls`, and § the bar that leaves
while you read), src/web/styles/crumbs.css, src/web/styles/mode-band.css § mode band,
src/web/styles/tokens.css (`--bar-h`, `--bar-bottom`, `--bar-hide`), src/web/styles/narrow-window.css
(what it does to `.controls` and `--mode-w`), src/web/reader/Reader.tsx (`showBar`, `showCrumbs`,
`layoutKey`, the `.controls` JSX), src/web/scroll.ts (`controlsBar`, `stickyOffset`,
`watchBarVisibility`), src/web/HeadingsCrumbs.tsx, tests/crumbs-narrow.test.ts,
docs/project/narrow-windows.md.

Questions I most want answered:

1. Is the diagnosis right: is the only reason `.controls` starts right of the band that, before it
   sticks, it is level with the fixed band? Is anything else ever painted in the strip above the
   band (x from the spine to spine + --mode-w, y 0 to --bar-bottom) while the bar is stuck: the
   spine, the mode herald, a fade, a dialog anchor, the small-screen hint, anything in outline mode?
2. Will the CSS rule do what it says: negative margin-left + sticky `left` + width, on an element
   whose containing block is `.reader` with `min-width: max-content` and padding-left including
   `--mode-w`? Any case (horizontal scroll, safe-area insets, a classic scrollbar, `--page-w`) where
   it overflows or un-pins? Does its specificity beat everything that sets those three properties
   on `.controls`, including narrow-window.css?
3. Is the IntersectionObserver sentinel a sound "stuck" signal? Cases: page loaded already scrolled
   (`?at=`), `showBar` turning on after mount, the bar hidden by transform (`data-bars`), the
   masthead changing height, rubber-band overscroll on iOS, the safe-top lateness the plan accepts.
   Is there an existing signal I should reuse instead?
4. Does anything measure the bar's x or width (scroll.ts, useColumnContext, tooltips, tests) that
   this would surprise?
5. Is there a simpler design I passed over wrongly, or a product tweak that removes the need for
   the attribute?
6. Are the tests in the plan able to go red for the right reason?

Give findings as P0/P1/P2 with file:line evidence, and end with one line: `VERDICT: approve`,
`VERDICT: approve with changes`, or `VERDICT: rework`.
