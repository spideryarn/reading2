# Code review — iOS layout and zoom after a rotation

## Verdict: LAND WITH FIXES

The design is sound. The cap prevents `.reader`'s own stale minimum from widening the page, and
`overflow-x: clip` contains the stale in-flow, absolute and sticky geometry without creating a
scroll container. I found no reader UI whose intended resting position depends on painting outside
the reader's horizontal edge.

I did find a material hole in the browser regression: the row named “Marginalia” rendered neither a
margin note nor its fixed heading. It passed on the stale masthead, just like every other row. I
fixed that and the inaccurate explanations around it. With those fixes, I would land the change
after the browser test has run once in an environment permitted to launch Chrome and WebKit.

## What I checked

### Clipping and positioned descendants

- `Tooltip`, `ProseHoverCard`, and `BlockLinkCard` render through a floating portal (the block-link
  card may instead portal into the dialog root). They are not ordinary absolute descendants of
  `.reader`.
- The mode band is `position: fixed` in every arrangement and at every breakpoint. The spine,
  TouchSelectionChip, Marginalia heading, dock/return chips, and dialogs are also fixed or in the
  browser's top layer. No ancestor from them through `.reader`, `#root`, and `body` has
  `transform`, `filter`, `perspective`, `will-change`, or `contain` that would re-home a fixed
  containing block.
- The absolute BlockGutter controls sit inside the text cell's allocated gutter. Marginalia notes
  sit in the reserved margin geometry. The other absolute descendants I traced stay within their
  positioned component. Focus outlines have room in their control geometry.
- The narrow-window `.controls:has(> .crumbs)` negative margin cancels the reader's `--mode-w`
  padding while the bar is stuck; it reaches the page edge rather than crossing it.
- A viewport-fixed descendant whose containing block lies outside `.reader` is not clipped by that
  intervening overflow clip. Fixed positioning uses the viewport unless a containing-block-forming
  ancestor intervenes, and off-viewport fixed content cannot make a scrollable route to itself.
  See [CSS Positioned Layout 3](https://www.w3.org/TR/css-position-3/) and
  [CSS 2.1 overflow clipping](https://www.w3.org/TR/CSS22/visufx.html#overflow-clipping).

### Sticky and containment behaviour

`overflow: clip` does not create a scroll container or a formatting context, so it does not replace
the viewport as the sticky bars' scrollport or create a containing block/stacking context. The
relevant definition is [CSS Overflow 3 § 3.1](https://www.w3.org/TR/css-overflow-3/#overflow-properties).
The reader's current sticky elements are vertical: `.masthead`, `.controls`, and the zero-height
table head. The old horizontal `pin-left` path no longer has current markup.

The strengthened browser regression now scrolls the clipped reader vertically and asserts that the
controls remain at `top: 0`; where a mode band exists, it also checks the fixed band remains painted
and hit-testable.

### Regression-test soundness

- Every rotation row has its own positive control: current markup with the clip removed and bare
  pixel `min-width`, followed by the same resize, must produce `documentElement.scrollWidth >
  clientWidth`. A row cannot quietly pass merely because its stale layout happened to fit.
- The real assertion checks both sides of the trade-off: the document remains contained, while
  `.reader.scrollWidth` must still expose the clipped stale layout.
- Marginalia rows now render a real `.marg-note` and `.marg-head`, carry the production `--marg-*`
  variables, and assert that both still have stale geometry beyond the new viewport. There is also
  a combined band-plus-Marginalia row.
- The at-rest control runs for every row. Fonts do not decide whether the rotation fixture
  overflows: its stale masthead/table/margin dimensions are explicit pixels. The sibling masthead
  test retains its old-rule positive control for the fallback-font case where text width does
  matter.
- Browser availability detection is appropriately strict: absence skips an engine; an installed
  but broken engine fails rather than being reported as a skip.

### Other overflow checks

The current reader-specific checks are the rotation test, the masthead wrapping test, and
`docs/project/narrow-windows.md`; all inspect `.reader.scrollWidth` as well as the document. I found
no other current test or script using only `documentElement.scrollWidth` as a reading-view overflow
oracle.

## Fixes made

- [`tests/reader-after-a-rotation-in-a-browser.test.ts`](../../tests/reader-after-a-rotation-in-a-browser.test.ts)
  — made Marginalia coverage non-vacuous; added the combined band/Marginalia arrangement; asserted
  stale note/head geometry; added behavioural sticky and fixed-descendant checks.
- [`src/web/styles/shell.css`](../../src/web/styles/shell.css)
  — corrected the new comment's claim that the clip catches every descendant; it now distinguishes
  fixed descendants and records the containing-block invariant.
- [`docs/plans/261008b-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md`](261008b-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md)
  — corrected the diagnosis from stale `min-width` alone to all stale pixel geometry, fixed the test
  filename and assertion description, and documented the actual arrangements and checks.
- [`docs/postmortems/261008a-a-width-from-the-last-render-meets-the-browser-before-the-next-one.md`](../postmortems/261008a-a-width-from-the-last-render-meets-the-browser-before-the-next-one.md)
  — corrected the claim that React hears the rotation only from `resize`; the hook also listens to
  `orientationchange` and the root `ResizeObserver`.

## Findings not fixed

1. **Wider documentation:** [`docs/reusable/design-a-screen.md`](../reusable/design-a-screen.md)
   still gives `scrollWidth > clientWidth` as the generic horizontal-overflow check without the
   reading-view exception. On `.reader`, the document-only form is now deliberately blind; the
   reusable checklist should point reading-view work to `.reader.scrollWidth` as
   `narrow-windows.md` does. This is a shared rule document, so changing it requires the repository's
   approved before/after process and is outside this stage.
2. **Pre-existing dead horizontal-scroll history:** the opening comment in `shell.css`, its header
   comment, and parts of `table.css` still describe page-level horizontal table scrolling and
   `pin-left` cells. The gist-column markup and `pin-left` rules are gone, and the new clip makes
   page-level horizontal scrolling impossible. This is a wider cleanup across the table/mode-band/
   dock comments rather than a defect in this fix.

I found no unfixed product-code defect in this stage.

## Verification

- `npx vitest run tests/layout.test.ts tests/layout-margin.test.ts tests/chat.test.ts` — **135 passed**.
- `npx vitest run tests/reader-after-a-rotation-in-a-browser.test.ts -t 'at every width'` — the
  exhaustive 100–2600px fit sweep passed.
- Direct `tsc --noEmit` for the root, web, tests, and fleet-web projects — **passed**.
- Biome on the touched CSS and test — **no errors**; it repeats the pre-existing informational
  complexity warning for the exhaustive nested sweep.
- `git diff --check` — **passed**.
- Chrome and Playwright WebKit browser cases — **not runnable in this managed sandbox**. Chrome
  (system and bundled) is killed after crashpad cannot create its socket (`Operation not
  permitted`); WebKit likewise cannot adopt its IPC socket. This is an environment restriction,
  not a test assertion failure, but the newly added browser checks remain dynamically unverified
  here.
- `npm test` — **could not start the suite** because the local Postgres service is unavailable and
  the harness intentionally refuses to skip database suites. Per the review boundary, I did not
  start or modify any database.

## Final disposition

**LAND WITH FIXES.** I changed the rotation browser test, `shell.css`, the plan, and the
postmortem. The unfixed findings are the wider reusable-checklist omission and the pre-existing
dead horizontal-scroll comments described above; neither is a product-code defect in this stage.
