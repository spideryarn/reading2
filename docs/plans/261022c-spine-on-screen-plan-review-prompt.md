Review the plan at docs/plans/261022c-spine-shows-clearly-what-is-on-screen.md before it is built. Read-only: do not edit files.

Context: Greg (the product owner) asked "Make it a bit clearer in the spine which bits are visible on the screen." Constraint: quiet enough not to compete with the prose. The rail is src/web/Spine.tsx (see § scroll position, the effect that writes translateY to `.spine-viewport-track`, and the render order of the track's children near the end of the component) and src/web/styles/spine.css (`.spine-viewport`, `.spine-here`, `.spine-part`). The key on the spine's card is `.tip-key-screen` in src/web/styles/tooltip.css and src/web/spine-key.tsx. Paint-order tests: tests/spine-here.test.ts, tests/spine-jump-origin.test.ts; scroll test: tests/spine-scroll.test.ts.

Please check:
1. Is the design (a box-shadow veil below the marks + orange edges on top) sound? Anything that would make it fail: clipping, compositing/layer cost (will-change on a second wrapper with a 200vh spread shadow), the 2px min-height floor of the band at the end of the article, `overflow: hidden`, safe-area insets, the bar flip's 180ms `top` transition on `.spine`.
2. Does writing the same transform to two wrappers risk them drifting apart (e.g. one rendered conditionally)?
3. Accessibility: forced-colors, prefers-contrast.
4. Is there a simpler design that achieves the goal as well?
5. Anything the plan misses (tests, docs that describe the band, e.g. docs/project/granularity-zoom.md, the help pages under docs/ or src/ that describe the spine's colours).

Give a verdict line first: "VERDICT: approve", "VERDICT: approve with changes", or "VERDICT: rethink", then numbered findings with file:line references.
