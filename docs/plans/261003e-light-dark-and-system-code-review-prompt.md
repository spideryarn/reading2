Code review of the Light / Dark / System appearance work, commit 0f49c71ef on this worktree's branch. The plan, with your own plan review folded in at its end, is docs/plans/261003e-light-dark-and-system-appearance-on-profile.md; the scoped diff is docs/plans/261003e-light-dark-and-system-code-review.diff.

Under the house workflow you may FIX what you find inside this change (sandbox workspace-write): edit the files, keep the tests green (run the specific vitest files you touch and `npm run typecheck`; do not run the full suite, the box is busy), and do not commit. Report anything wider for me to decide.

Look especially for:
- the before-paint path: index.html's inline script, src/web/appearance.ts (startAppearance, setAppearance, useTheme, useAppearance snapshot correctness under useSyncExternalStore, listeners on System), and whether any state can show the wrong theme or a stale control;
- the Tailwind dark variant in src/web/tailwind.css and any shadcn component that now renders differently in DARK (dark must look exactly as before);
- the --highlight-text sweep (178 sites): any place that was an area/fill/border and wrongly moved, or any orange text left on --highlight;
- the light blocks in styles/tokens.css, styles/colourscales.css, src/web/styles/tokens.css: missing tokens, wrong values, light contrast problems; and whether the tests (tests/appearance*.test.ts, tests/colour-scales.test.ts, tests/hit-colours.test.ts) can actually fail and check what they say;
- remaining hard-coded colours that would be wrong in light (CSS and TSX), and the allowlist in tests/appearance-fixed-colours.test.ts;
- feedback diagnostics fields (src/feedback-payload.ts, src/web/feedback-diagnostics.ts);
- docs that are now false.

Answer with numbered findings, P0/P1/P2, file:line, what was wrong, and whether you fixed it (and how) or left it for me. Then a one-paragraph verdict.
