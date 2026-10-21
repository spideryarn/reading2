## Findings

- **P2 — fixed:** Static bare-package imports were invisible. Adding `import "p-queue"` to both `AdminCostsPage.tsx` and eager `App.tsx` left all 12 tests green. The guard now tracks packages and directly imported assets, with a two-way allowlist in [eager-client-graph.test.ts](/var/tmp/spideryarn-worktrees/qi-pgy5fdce-eager-graph-admin-roots/tests/eager-client-graph.test.ts:280). The same plant and a temporary shared CSS asset now fail correctly.

- **P3 — fixed:** Comments and the plan described `ROUTE_PRIVATE` as an exhaustive inventory, but it contains 15 of 30 route-private modules. It is actually calibration: all five roots plus representative dependencies. The seam catches unlisted modules. Wording and test names now reflect that in the [test](/var/tmp/spideryarn-worktrees/qi-pgy5fdce-eager-graph-admin-roots/tests/eager-client-graph.test.ts:783) and [plan](/var/tmp/spideryarn-worktrees/qi-pgy5fdce-eager-graph-admin-roots/docs/plans/261022a-eager-client-graph-guard-derives-every-lazy-admin-route.md:25).

- **P3 — wider, unchanged:** [App.tsx](/var/tmp/spideryarn-worktrees/qi-pgy5fdce-eager-graph-admin-roots/src/web/App.tsx:48) still says “three routes” and “six loaders”; the block now has six admin loaders plus Design, Changelog, and Help. I left it untouched per scope.

The 13 new `SHARED_WITH_READER` entries are independently eager and therefore zero-cost. Their paths run through `ArticleCost`, direct `App`, `App → useJobs`, or `Library → useShelf`; the explanatory comment is accurate.

Silent-success probes passed: misclassifying one root and forcing an empty derivation both failed calibration.

Plants, all removed: `useAdminVouchers`, unlisted `admin-vouchers-parts`, `p-queue`, temporary `review-admin-route.css`, one wrong `NOT_ROUTE_ROOTS` entry, and an empty-root filter. Source files are clean.

Checks: focused suite 12/12, Biome clean, full typecheck green. `npm test` could not start without local Postgres/Docker; the broader unit run also encountered unrelated sandbox failures in `run-codex.test.ts`.

APPROVE WITH FIXES APPLIED