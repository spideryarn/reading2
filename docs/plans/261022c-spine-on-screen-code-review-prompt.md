Code review of the change for docs/plans/261022c-spine-shows-clearly-what-is-on-screen.md (read the plan first, then the diff at docs/plans/261022c-spine-on-screen-code-review.diff; the plan review you did is docs/plans/261022c-spine-on-screen-plan-review-sol.md).

Summary: the spine (12px rail, src/web/Spine.tsx + src/web/styles/spine.css) now veils everything off screen via a second translateY-moved wrapper `.spine-veil-track` whose ::before/::after are the veil; the orange `.spine-viewport` lost its wash; the card key swatch (tooltip.css) matches; forced-colors and prefers-contrast handled; help page + corpus + granularity-zoom.md updated; tests extended. Also a bug fix found on the browser pass: `.spine` now stops at the bottom bar (`bottom: calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-now))`, same as `.mode-band`), where before the dock covered its last ~40px.

Browser evidence (Playwright, this box): veil gap equals the orange box to <0.001px at desktop/phone in both themes; forced-colors: veil display none, border Highlight; contrast more: 2px edges; rail 44–860 on a 900px window after the bottom fix, with the band visible at the rail's foot at the end of the article.

Please look for correctness bugs and fix what you find inside this change (you have workspace-write). Specifically consider:
- the bottom fix: any other element positioned against the spine's bottom or assuming the rail reaches the screen bottom (search src/web for spine geometry used in JS, e.g. hover card placement, keynav, Spine.tsx measuring the track, tests/fixtures); whether `.spine` should also follow the bar's motion like `.mode-band` does; narrow-window.css rules touching `.spine`;
- whether `--view-h` / `max(..., 2px)` matches the band's floor exactly;
- cascade/specificity: `:root[data-theme="light"] .spine` vs the `prefers-contrast` block (light + contrast more must get 60%; check order and specificity);
- anything stale in comments or docs (docs/project/*.md describing the spine's bottom or the band).

Run `npx vitest run tests/spine-*.test.ts tests/spine-card.test.tsx tests/help-corpus.test.ts` and `npm run typecheck` after any fix.

Start your answer with "VERDICT: ship", "VERDICT: ship after fixes (applied)", or "VERDICT: do not ship", then numbered findings with file:line and what you changed.
