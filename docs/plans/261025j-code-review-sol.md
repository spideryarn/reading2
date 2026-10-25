No P0 or P1 findings.

- **P2 — Adjacent touch targets overlapped by 4px. Fixed.** The coarse-pointer masthead pie had `margin-left: -4px`, overlapping the read-time target. Removed the offset and added a regression assertion at [share-pie.css:37](/var/tmp/spideryarn-worktrees/fbe5477u-how-much-read/src/web/styles/share-pie.css:37) and [touch-targets-261021g.test.tsx:265](/var/tmp/spideryarn-worktrees/fbe5477u-how-much-read/tests/touch-targets-261021g.test.tsx:265).

- **P2 — Comments and plan falsely claimed chat could not disagree with, or exceed, the masthead band. Fixed.** Chat includes folded matter: unread matter can lower its share, while read matter can raise it. Corrected [read-filter.ts:126](/var/tmp/spideryarn-worktrees/fbe5477u-how-much-read/src/web/read-filter.ts:126), [reading-so-far.ts:14](/var/tmp/spideryarn-worktrees/fbe5477u-how-much-read/src/reading-so-far.ts:14), and the affected documentation.

- **P2 — Tests could pass with the Reader→Masthead feature wiring removed, and did not exercise the promised byline fallback. Fixed.** Added wiring coverage at [masthead-read-so-far.test.tsx:83](/var/tmp/spideryarn-worktrees/fbe5477u-how-much-read/tests/masthead-read-so-far.test.tsx:83), fallback coverage at [read-band.test.ts:131](/var/tmp/spideryarn-worktrees/fbe5477u-how-much-read/tests/read-band.test.ts:131), and included the mark in the Chrome wrapping fixture at [masthead-facts-wrap-in-chrome.test.tsx:102](/var/tmp/spideryarn-worktrees/fbe5477u-how-much-read/tests/masthead-facts-wrap-in-chrome.test.tsx:102).

Status gating, stale-ID exclusion, visitor gating, memo dependencies, `TableView`’s old `echo ∪ stretches` behavior, and the intended quiz denominator change otherwise look correct.

Checks:

- 217 focused tests passed.
- Typecheck passed for all five projects and covered all 4,018 source files.
- Biome lint passed on all touched TypeScript files.
- `git diff --check` passed.
- The Chrome wrapping test was attempted, but Chrome exited before opening a page because crashpad cannot create its sandbox socket (`SIGTRAP`/`EPERM`). This was an environment failure, not an assertion failure.

Files changed:

- `docs/plans/261025j-how-much-of-the-article-you-have-read-at-the-top.md`
- `docs/project/reading-time.md`
- `src/reading-so-far.ts`
- `src/web/read-filter.ts`
- `src/web/styles/share-pie.css`
- `tests/masthead-facts-wrap-in-chrome.test.tsx`
- `tests/masthead-read-so-far.test.tsx`
- `tests/read-band.test.ts`
- `tests/touch-targets-261021g.test.tsx`