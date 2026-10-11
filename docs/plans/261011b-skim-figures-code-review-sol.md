SHIP AFTER MY FIXES

1. **HIGH — Fixed:** Figures was a dead end when no route was ready. Added a count-less **Route** chip that returns to the route’s empty/loading/failed surface without starting another job or inventing a stop. [SkimMode.tsx](/var/tmp/spideryarn-worktrees/fbsb0c7e-figures-and-tables-nav/src/web/modes/skim/SkimMode.tsx:370), [SkimPanel.tsx](/var/tmp/spideryarn-worktrees/fbsb0c7e-figures-and-tables-nav/src/web/SkimPanel.tsx:616), [FiguresWalk.tsx](/var/tmp/spideryarn-worktrees/fbsb0c7e-figures-and-tables-nav/src/web/modes/skim/FiguresWalk.tsx:114)

2. **MEDIUM — Fixed:** Coverage did not prove opening-token consumption, Back/Forward’s zero-arrival behavior, figureless stale URLs, or visitor isolation. Added outcome-level tests, including a visitor switching into Figures with zero network requests. [skim-figures.test.tsx](/var/tmp/spideryarn-worktrees/fbsb0c7e-figures-and-tables-nav/tests/skim-figures.test.tsx:344)

3. **LOW — Fixed:** Documentation said the no-route Figures view had only one chip and claimed Structure used a prefix sum, while the implementation correctly scans figure row indices. Updated the plan and project documentation. [261011b-skim-figures-walk-and-structure-figure-marks.md](/var/tmp/spideryarn-worktrees/fbsb0c7e-figures-and-tables-nav/docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md:127), [skim.md](/var/tmp/spideryarn-worktrees/fbsb0c7e-figures-and-tables-nav/docs/project/skim.md:660)

4. **LOW — Left for you, wider than this change:** Biome retains pre-existing advisories for `SkimPanel` complexity and an optional-chain style suggestion. Neither was introduced by this change or affects correctness. [SkimPanel.tsx](/var/tmp/spideryarn-worktrees/fbsb0c7e-figures-and-tables-nav/src/web/SkimPanel.tsx:733)

Tests: **PASS** — 10 requested files, 459 tests.

Typecheck: **PASS** — all four projects, 3,676 source files. The exact `npm run typecheck` wrapper could not open `tsx`’s Unix socket in the sandbox (`EPERM`); running the same driver as `node --import tsx scripts/typecheck.ts` passed completely.

No commit made.