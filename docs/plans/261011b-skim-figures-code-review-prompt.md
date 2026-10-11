You are the code reviewer for plan docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md in this working tree (Spideryarn). You reviewed the plan earlier (docs/plans/261011b-skim-figures-plan-review-sol.md); now review the code built from it, and **fix what you find** inside this change's scope (sandbox is workspace-write). Do not commit, and do not run git commands that change state (no stash/reset/checkout/restore/commit). Report anything wider than this change for me to decide.

The change is everything since commit 28292717e on this branch, committed and uncommitted:
  git diff 28292717e -- . ':!docs/plans/*.png'
Key files: src/figures.ts, src/web/FigureMark.tsx, src/web/StructurePanel.tsx, src/web/OutlinePanel.tsx, src/web/modes/structure/StructureMode.tsx, src/web/modes/skim/FiguresWalk.tsx, src/web/modes/skim/walk.ts, src/web/modes/skim/SkimMode.tsx, src/web/SkimPanel.tsx, src/web/params.ts, src/web/skim-route.ts, src/web/styles/skim.css, src/web/styles/structure-mode.css, tests/figures.test.ts, tests/structure-figure-marks.test.tsx, tests/skim-figures.test.tsx, docs/project/skim.md, structure.md, url-state.md, keyboard.md.

A browser check (Playwright, local article with 5 figures and a video, no Skim route planned) found: the Figures walk, door, keys, reload and Structure marks all work with no console errors; the door's next caption ran to nine lines (now clamped to two via .skim-door-caption); on an 800px Structure list a long title's mark wraps under it (minor).

Specific things to check and fix:
1. Known gap, please fix: while walking Figures with no ready route (none/loading/failed), the head shows only the Figures chip, pressed, so the reader has no control back to the route's state (its empty "Plan the route", its loading line, or a failed plan). Offer a way back (e.g. a Gist/route chip that returns to the route view whatever its status), simplest correct shape.
2. Correctness of the two-walk switch: SkimControl stability (no render loop), arrival token claims (deep link, opening, part switch — one history entry), Back/Forward arming nothing, the route walk's passage cleanup leaving no quote ring under Figures, `?depth=figures` on an article with no figures, a stale `?stop=`.
3. Visitor band (VisitorSkimBand) gets the chip and cannot reach owner-only reads or start a job.
4. Structure marks: range counting by row index only; drawn vs measured copies identical; the accessible name.
5. Anything that reports success while doing nothing (docs/reusable/silent-success.md), and tests that could never go red.
6. Docs accurate against the code.

After fixing, run: npx vitest run tests/figures.test.ts tests/structure-figure-marks.test.tsx tests/skim-figures.test.tsx tests/skim-panel.test.tsx tests/skim-route.test.ts tests/last-view.test.ts tests/client-imports.test.ts tests/stale-notice-every-mode.test.tsx tests/every-mode-draws-its-surface.test.tsx tests/a-broken-mode-leaves-the-article-readable.test.tsx, and npm run typecheck.

Answer: a verdict line first (SHIP / SHIP AFTER MY FIXES / DO NOT SHIP), then numbered findings with severity, file:line, and for each whether you fixed it (and how) or left it for me, then the test/typecheck summary lines.
