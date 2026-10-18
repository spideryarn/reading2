You are reviewing CODE for the Spideryarn reading app (this worktree). You may FIX what you find, inside this change's scope (src/web/styles/gutter.css's new last block, the new nested block in src/web/styles/narrow-window.css, tests/gutter-phone-bar.test.ts, docs/project/touch.md's new paragraph). Report anything wider rather than changing it. Do not run git commands that change history or the index; do not commit.

Read the plan first: docs/plans/261018g-phone-portrait-gutter-icons-above-the-paragraph.md (incl. § What the plan review changed and § What the screenshots showed), and your own plan review at docs/plans/261018g-phone-gutter-plan-review-sol.md. The diff is docs/plans/261018g-phone-gutter-code-review.diff (the new test file is appended at its end). Screenshots after the change: docs/plans/261018g-shot-5..11-*.png.

Check in particular:
- Cascade correctness under `(max-width: 731px) and (hover: none)`: every rule in gutter.css/footnotes.css/narrow-window.css that targets .blk-gutter or its children (incl. the @container count rules, the one-slot mark/"…" sharing rules with grid-area 1/1 at rest, [data-open], (any-pointer: coarse) z-index and span.blk-read::before, .blk-permalink.failed, :focus-visible rules, the (hover: none) 0.705 reveal) — does anything win that should not, at rest or in the bar? At rest: is the mark's glyph inside the 1.25rem pad, and does `justify-content: flex-end; padding-inline-end: 4px` on every child break the "…"/mark slot sharing on a one-line row, or a count's layout?
- The bar position `bottom: calc(100% - var(--blk-top) + 2px)` on a heading row (whose --blk-top / height differ) and a footnote row.
- BlockGutter.tsx's JS that decides which controls are focusable/visible (around line 421, `:scope > *`, offsetParent) — still right when the bar shows all controls?
- Whether tests/gutter-target-size.test.ts or gutter-touch-contrast.test.ts's assumptions are now false on the phone (e.g. the strip's tap target, contrast of 0.705 over --page in the bar).
- The test file: does each assertion fail if the thing it names is removed?

Run `npx vitest run tests/gutter-phone-bar.test.ts tests/gutter-target-size.test.ts tests/gutter-touch-contrast.test.ts tests/block-gutter.test.tsx` and `npm run typecheck` after any fix.
Write findings ranked P0/P1/P2 with file:line, what you fixed, and end with a line: VERDICT: ship / ship after fixes (done) / do not ship.
