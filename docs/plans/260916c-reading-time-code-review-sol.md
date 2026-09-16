Found and fixed two P1s and one P2.

Changes:

- [Findings](/home/greg/code/spideryarn2/.claude/worktrees/fb41-reading-time-heatmap/docs/plans/260916c-reading-time-code-review-findings-sol.md)
- [useReadingTime.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb41-reading-time-heatmap/src/web/useReadingTime.ts): ordered opening reads and writes, including remount and bfcache races.
- [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb41-reading-time-heatmap/src/routes.ts): corrected the maximum-body calculation and rejected surplus fields.
- [use-reading-time.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb41-reading-time-heatmap/tests/use-reading-time.test.tsx): added delayed-GET, bfcache, and cleanup/remount regressions.
- [reading-time-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb41-reading-time-heatmap/tests/reading-time-route.test.ts): added true maximum-number and exact-shape cases.
- Updated the plan and reading-time project documentation for the new ordering guarantee.

The switch-off and shared-link conclusions hold: no reading-time request, timer, sampling, state-driven rerender, or drawing occurs while off; visitors never receive the capability, and both server verbs remain owner-scoped.

Not fixed:

- No candidate finding remains unfixed.
- I did not touch the unrelated untracked feedback note. Its broken link caused the only doc-links failure.
- No browser check was run; the planned visual acceptance check remains outstanding.
- The database-backed route test could not run because local Postgres/Docker was inaccessible in this sandbox.

Verification:

- Seven scoped unit files: **452/452 passed**.
- `tests/use-reading-time.test.tsx`: **11/11 passed**.
- Coverage-aware typecheck via `node scripts/typecheck.ts`: **exit 0**, all four projects and 2,201 source files covered.
- `npm run typecheck`: wrapper failed before checking because `tsx` could not create its IPC socket; the underlying coverage-aware script passed.
- Biome: exit 0, with three pre-existing complexity notices in `src/routes.ts`.
- `git diff --check`: exit 0.
- Expanded run including doc links: **465 passed, 1 unrelated failure** from `docs/user-feedback/260912_1227-where-you-have-spent-time-reading.md` linking to a nonexistent filename.