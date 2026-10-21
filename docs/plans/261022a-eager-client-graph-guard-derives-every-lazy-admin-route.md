# The eager-client-graph guard derives every lazy admin route

Overseer queue item **qi-pgy5fdce**, from GPT Sol's review of 261021i stage 1, finding C4
([261021i-…-stage1-code-review-sol.md](261021i-admin-tables-share-one-sortable-hideable-table-stage1-code-review-sol.md)).
A test-only change: `tests/eager-client-graph.test.ts`.

## The gap

The guard walks the reader's static import closure and asserts that the lazy admin and `/design`
routes stay out of it. It named its far side by hand: `ROUTE_ROOTS` was `AdminPage.tsx` and
`DesignPage.tsx`, and `ROUTE_PRIVATE` six modules. `/admin/costs`, `/admin/vouchers` and
`/admin/articles` became chunks of their own later (`App.tsx § ADMIN_LOADERS`) and neither list
heard. So a module private to one of them could join every reader's startup unnoticed.

**Reproduced before the fix:** `import "./useAdminCosts.js"` planted in `src/web/App.tsx` left all
9 tests green.

## The change

- **`ROUTE_ROOTS` is derived** from the `import()` edges the eager walk already records: every
  local lazy target that a new `NOT_ROUTE_ROOTS` map does not claim (with a reason each:
  `main.tsx`, `lib/supabase.ts`, `ChangelogPage`, `HelpPage`, `temml` and its CSS). The default is
  the safe one: a new lazy page is treated as admin-only until someone classifies it, so the seam
  test asks about it the day its loader is written.
- **`ROUTE_PRIVATE` stays a readable hand list**, widened from six names to fifteen: every route
  root plus representative private modules from the three newer pages. It is now also
  **calibration**: a new test asserts every entry is reached by the derived route closure, so a
  derivation that loses a root goes red rather than shrinking the seam to something that passes.
- Two more new tests: every lazy **package** import is classified, and `NOT_ROUTE_ROOTS` has no
  stale lines; and the route closure opens no `import()` of its own that is not walked.
- The seam also records static **package and local-asset** imports made by route-private files.
  Without that, importing the same admin-only package directly from the eager graph crossed the
  bundle boundary without a local file crossing it. Externals already shared with the reader are
  named in the shorter `SHARED_EXTERNALS_WITH_READER` allowlist.
- **`SHARED_WITH_READER` gains thirteen entries** the wider walk found already shared: `cost-cube.ts`
  (the article page's cost line), `made-for.ts` (App.tsx's), and eleven behind
  `admin-vouchers-parts.tsx`'s reuse of `useShelf` and `useJobs`. All were already in the reader's
  startup, so they cost readers nothing; the list's comment says so.

## Simpler option passed over

Add the three page names to both hand lists. It closes today's gap and reopens it with the next
admin page, which is how this one happened. Deriving takes about a dozen lines more.

A fully derived `ROUTE_PRIVATE` (route closure minus `SHARED_WITH_READER`) was tried and dropped:
it makes the absence test the same check as the seam's "unexpected" half, so it adds nothing.

## Evidence

- With the plant: red in *does not reach the administrator's pages* (`useAdminCosts.ts`, chain
  `main.tsx -> App.tsx -> useAdminCosts.ts`) and in the seam test. Plant removed: 12/12 green.
- Review plant: `import "p-queue"` in both `AdminCostsPage.tsx` and `App.tsx` left 12/12 green before
  package edges joined the seam, then failed on `p-queue`. Both imports removed.
- Review asset plant: both pages imported a temporary `review-admin-route.css`; the seam failed on
  its repo-relative path. Both imports and the stylesheet were removed.
- `AdminCostsPage.tsx` planted into `NOT_ROUTE_ROOTS`: red in *derived a route closure that reaches
  every named calibration module*. Making the whole root derivation empty failed on all fifteen
  names. Both plants removed.
- `npx vitest run tests/eager-client-graph.test.ts`: 12/12 green;
  `node --import tsx scripts/typecheck.ts`: all four projects green; `biome check` clean on the file.
