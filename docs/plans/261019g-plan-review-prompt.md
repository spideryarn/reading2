You are reviewing a plan, read-only, before it is built. Repository: this checkout (Spideryarn, a web reading app; React + Vite, CSS in src/web/styles and styles/).

Read docs/plans/261019g-reading-comfort-on-profile-brightness-and-text-size.md. Also read the prior plan it supersedes in part, docs/plans/261003a-reading-text-size-setting.md, and docs/plans/261003e-light-dark-and-system-appearance-on-profile.md for the Appearance machinery it copies (src/web/appearance.ts, src/web/AppearanceSetting.tsx, index.html's appearance-boot script, tests/appearance.test.ts).

Check the plan's claims against the code, especially:
1. That scaling the html root font-size (112.5/125/137.5%) keeps the type hierarchy and layout working: are there px-based font sizes, line-heights, heights, offsets or JS constants (src/web/layout.ts, src/web/reader/measure.ts, gutter, sticky bars, spine, marginalia, virtualisation/row-height estimates, scroll restoration) that assume a 16px root and would misalign or overflow? Name file:line.
2. That an html::after fixed overlay with pointer-events:none and z-index max is safe: anything that uses elementFromPoint, hit testing, top-layer dialogs/popovers not listed, html::after already used, screenshots, print styles (should dimming be off in print?), iOS Safari overscroll/safe-area gaps.
3. Whether per-device localStorage is right vs a profile column, given the reasons stated.
4. Anything simpler, or any step missing (e.g. signed-out site pages built by scripts/build-site-pages.ts or client-shell.ts that might not include the boot script; /help text; the /design bigRoot switch interacting with data-text-size).
Write findings ranked P0/P1/P2 with file:line evidence, then a one-line verdict: BUILD AS IS, BUILD WITH CHANGES, or STOP.
