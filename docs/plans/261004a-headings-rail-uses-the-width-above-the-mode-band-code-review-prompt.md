You are reviewing code in the Spideryarn repo (this worktree), and you may fix what you find inside
this stage's scope. Report anything wider for me to decide rather than changing it.

The plan: docs/plans/261004a-headings-rail-uses-the-width-above-the-mode-band.md
Your own plan review: docs/plans/261004a-headings-rail-uses-the-width-above-the-mode-band-plan-review-sol.md
The change: commit c795b9e08 (`git show c795b9e08`). Files:
  src/web/scroll.ts (`watchBarStuck`), src/web/BarStuckSentinel.tsx, src/web/reader/Reader.tsx
  (the sentinel before `.controls`), src/web/styles/crumbs.css (§ above the band),
  tests/bar-stuck.test.ts, tests/crumbs-narrow.test.ts, tests/headings-crumbs-wiring.test.tsx,
  docs/project/experimental-features.md.

What it does: beside an open mode band on a wide window, the controls bar holding the headings
breadcrumb used to start at the band's right edge, leaving the strip above the band empty while the
path was truncated. Now, once the bar is stuck at the top (`data-bar-stuck` on the root, set from an
IntersectionObserver on a zero-height sentinel directly before the bar), one CSS rule starts the bar
at the spine.

Check, against the code rather than my prose:
1. Did each of your four plan-review findings land properly (CSS test asserts all three
   declarations; a wiring test through the real `Reader`; the `stopped` guard for a queued entry;
   the sentinel keyed to `showCrumbs`)? I watched the wiring test go red with `showBar` in place of
   `showCrumbs`.
2. `watchBarStuck`: is `entries.at(-1)` the right entry to trust; is `!isIntersecting && top < 0`
   right for a zero-height target, at the exact boundary, on a page loaded already scrolled, under
   iOS rubber-band overscroll, and with StrictMode's double effect? Any way the attribute is left
   set with no bar, or set while the bar is level with the band?
3. The CSS rule in crumbs.css: specificity against every other rule that sets `margin-left`,
   `left` or `width` on `.controls` (shell.css, narrow-window.css and anything else); behaviour when
   `--mode-w` is 0; any interaction with `transform: translateY(var(--bar-hide))`, the
   `:root:has(... .controls > .crumbs)` guards in shell.css, the narrow three-line rules in
   crumbs.css, or `overflow` on the bar at 731px and under.
4. Does the new direct child of `.reader` disturb anything that assumes the bar's siblings or the
   order of `.reader`'s children (scroll.ts, ViewportProbe.tsx, CSS sibling selectors, tests)?
5. Comments and the doc sentence: are any claims in them false or unverified? Keep the house style
   (plain words, no restating the code).
6. Run the three test files above, `npm run typecheck`, and lint the touched files. Do not run the
   full suite; I run that separately.

A browser check of the real layout at iPad sizes is running separately; you need not drive a browser.

Give findings as P0/P1/P2 with file:line evidence, say what you changed, and end with one line:
`VERDICT: approve`, `VERDICT: approve with changes` (you made them), or `VERDICT: rework`.
