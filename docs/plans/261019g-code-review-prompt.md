You are reviewing code before it is pushed, in this checkout (Spideryarn, a React + Vite web reading app). You may edit files to fix what you find.

The work: docs/plans/261019g-reading-comfort-on-profile-brightness-and-text-size.md (read it whole, including § Plan review — your own earlier review — and § Browser evidence). The diff is docs/plans/261019g-code-review.diff (commit f7d957c39 against b07a3e489; png and generated files excluded).

Two per-device reading-comfort settings on /profile: Brightness (a fixed black `:root::after` layer, `pointer-events: none`, plus a filter on `dialog[open]`) and Text size (`:root[data-text-size]` sets the root font-size; everything in rem follows; `layoutKey` in src/web/reader/Reader.tsx now carries `rootFontPx`). Stored in localStorage, applied before first paint by the inline `appearance-boot` script in index.html, kept in step by src/web/reading-comfort.ts (storage events, bfcache `pageshow`, failed writes), with a control in src/web/ReadingComfortSettings.tsx.

Review for correctness first:
1. Do index.html's inline script and src/web/reading-comfort.ts agree on every stored value, including junk and throwing storage? Does the test in tests/reading-comfort.test.ts actually exercise the inline script (could it pass for the wrong reason)?
2. reading-comfort.ts: the volatile/unsaved state, the storage and pageshow listeners, the `resize` dispatched on a text-size change (could it cause a loop, or fire during render?), `useSyncExternalStore` snapshots being stable, SSR/no-window safety if any server code imports it (feedback-diagnostics.ts imports it).
3. The CSS in src/web/styles/reading-comfort.css: does the overlay block anything (hit testing, selection, scroll), does `dialog[open]` filtering break anything inside the dialogs (position: fixed descendants inside a dialog, e.g. menus or the command bar), is the import order in src/web/styles.css right, does print turn it off?
4. Feedback payload (src/feedback-payload.ts, src/web/feedback-diagnostics.ts): do the new fields round-trip, are old reports without them handled, is anything that renders a report's device (admin pages, scripts/feedback-reporter.ts) now missing them or broken?
5. The px font-size guard in tests/reading-comfort.test.ts: does its regex miss obvious forms (shorthand `font: 13px/1.4 …`, uppercase PX, a value on the next line)? Fix if cheap.
6. Anything in the docs that is now false.

Fix what you find inside this work (edit the files directly; keep the house style: comments that say why, no new dependencies). Do not commit. Then run `npx vitest run tests/reading-comfort.test.ts tests/appearance.test.ts tests/feedback-diagnostics.test.ts tests/layout.test.ts` and `npm run typecheck`.

Finish with: the findings ranked P0/P1/P2 with file:line, what you changed for each, anything wider you did not change, the test and typecheck results, and a one-line verdict: SHIP, SHIP AFTER MY FIXES, or DO NOT SHIP.
