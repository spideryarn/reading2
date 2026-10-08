Code review of plan docs/plans/261008b-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md, as built in the last commit of this worktree (`git show HEAD`). You reviewed the plan (RETHINK) earlier today; the plan was revised to the `overflow-x: clip` + `min(px, 100%)` design — read its § The fix, including the measurements.

You may edit files (workspace-write). Fix what is inside this stage, narrowly, each finding red-first with a test that reproduces it where one can; report, do not fix, anything wider. Do not commit. Do not touch .env.local, infra/, or any database.

The change: src/web/layout.ts `readerMinWidth`; src/web/reader/Reader.tsx (uses it); src/web/styles/shell.css `.reader { overflow-x: clip }`; tests/reader-after-a-rotation-in-a-browser.test.ts (new; Chrome + Playwright WebKit); tests/masthead-facts-wrap-in-chrome.test.tsx (measures .reader scrollWidth too); docs/project/narrow-windows.md; the postmortem docs/postmortems/261008a-…md.

Look hard at:
1. Anything inside `.reader` that is legitimately visible beyond its left or right edge at rest and would now be clipped: popovers/hover cards/tooltips/menus positioned `absolute` within .reader (vs `fixed` or portalled), the gutter icons, Marginalia notes, the mode band (is it `fixed` in every arrangement, including desktop widths, and does any ancestor with transform/filter/contain make a fixed child clip-able?), the spine, focus rings at the edges, negative margins (e.g. narrow-window.css `.controls:has(> .crumbs)` uses `margin-left: calc(-1 * var(--mode-w))`!), the masthead centred over a text-alone column, selection chips, the TouchSelectionChip, BlockGutter, glossary cards, link cards (useHoverCard), dialogs. grep for `position: absolute` / `left:` negative / `margin-left: calc(-` in src/web/styles and for components rendered inside .reader. Check whether `overflow-x: clip` on .reader clips a sticky/fixed descendant in WebKit/Chrome given any transform on the way.
2. Does `overflow-x: clip` change sticky behaviour anywhere (horizontal sticky `left:` on .masthead/.controls/thead `pin-left`), or create any containing-block/stacking change?
3. Is the new test sound — red on the old code for the right reason (I saw 1194 vs 834), and its control non-vacuous for every ROTATIONS row? Anything flaky (fonts, scrollbar gutter, WebKit availability detection)?
4. Anything else that measures documentElement.scrollWidth as an overflow check (tests, scripts, docs) and is now blinded.
5. Comments and docs accurate?

If you can, verify point 1 empirically in Playwright (Chrome at /usr/bin/google-chrome-stable and playwright-core webkit) against real markup rather than by reading alone.

End with a verdict (LAND / LAND WITH FIXES / DON'T LAND), the list of fixes you made (files), and findings you did not fix. Write the answer to the output file.
