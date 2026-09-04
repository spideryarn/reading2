# Hierarchy should default to Spine, L1 and L2

**[SPIDERYARN-READING2-Z](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-Z)** · reported
2026-09-04 12:33 UTC · resolved 2026-09-04 · *shipped*

## What the reader said

> The Hierarchy mode should perhaps default to showing Spine, L1 and L2.

Twelve words, and the URL he sent it from says the rest: `…&mode=hierarchy&cols=1,2&…`. He had
already reached that arrangement by hand on an iPad, which is the strongest evidence the report
contains and is why the "when only one column fits, keep L1" question below answered itself.

## What we did

Changed the **automatic fit** in `src/web/layout.ts` § `fitView` — the branch that runs only when the
reader has not said what they want.

- L0 (the arc column) is no longer a candidate for automatic fit **at all**, however wide the window
  is. It used to appear whenever three columns fit, around 1100px and up.
- When the window squeezes, the selection now drops from the **finest** end first, so the last column
  standing is always L1, never L2.
- `?cols=` is untouched. An explicit choice still renders exactly what it asks for, including
  overflowing a narrow window when that is what was asked for.

The change is inside the fit function rather than at a call site, so the pending Structure work
([260903b](../plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md)) inherits it instead
of having to repeat it. That plan is still a proposal with nothing built, and `fitView` is still the
live path — checked rather than assumed.

## Verified in a browser, not only in tests

Playwright against system Chrome, `SPIDERYARN_STORE=postgres`, article `scaling-hypothesis`:

- **1600px, no `?cols=`** — Arg unlit, L1 and L2 lit; columns Parts / Sections / Text.
- **768px, no `?cols=`** — only L1 lit; a single Parts column beside the text.
- **`?cols=0,1,2` at 1600px** — Arg, L1 and L2 all lit and rendered, unchanged.

Tests in `tests/layout.test.ts` gained a block asserting all three, and several stale automatic-fit
assertions elsewhere had to be updated to the new numbers — which is the useful signal that the old
behaviour really was pinned and really did change.

## Docs

`granularity-zoom.md` owns this behaviour (not `hierarchy.md`, not `column-context.md`) and said the
opposite in three places: *"L0 is the first thing auto-fit gives up"* is now *"never opens L0 at
all"*, the "give up the coarse levels first" bullet is rewritten as L2-before-L1, and the worked
pixel examples were wrong for the new split and are corrected.
