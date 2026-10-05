Reviewed and fixed the established P1 defects. No unfixed P0/P1 findings remain. I did not change `src/cost-cube.ts`.

### Findings

- **F1 — P1 — established — fixed.** Pivot cells, totals, and estimated cash omitted the `+` floor marker when their aggregate contained unpriced calls. All money views now preserve that warning. [AdminCostsPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/AdminCostsPage.tsx:494)

- **F2 — P1 — established — fixed.** Under `period=all`, filtering shortened the chart’s date domain to the filtered rows. The axis now retains the whole fetched period, drawing empty days where the filter removed spend. [AdminCostsPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/AdminCostsPage.tsx:914)

- **F3 — P1 — established — fixed.** A genuine dimension value named `__other__` could collide with the synthetic folded bucket, duplicate keys, and make displayed cells exceed the grand total. The fold now mints a disjoint key and explicitly identifies the synthetic series. [admin-costs-view.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/admin-costs-view.ts:251)

- **F4 — P1 — established — fixed.** A chart containing only unpriced/zero recorded amounts invented positive `<$0.0001` axis ticks. It now draws only the true zero tick. [cost-charts.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/cost-charts.tsx:145)

- **F5 — P1 — established — fixed.** `?by=user&then=user` looked like no secondary grouping, but changing `by` later resurrected the hidden `then=user` and unexpectedly opened a pivot. Invalid same-dimension state is now cleared. [AdminCostsPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/AdminCostsPage.tsx:383)

- **F6 — P2 — established — fixed.** The question presets were buttons despite the plan requiring copyable links. They are now real links that preserve declared period, filters and sort state while excluding unknown parameters. [AdminCostsPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/AdminCostsPage.tsx:155)

- **F7 — P2 — reasoned — fixed.** At 390px, scaling a 640px SVG reduced the 11px axis text to roughly 5–6px. The chart now retains its 640px drawing width inside a horizontal scroller. It still contains no Tailwind classes and reads only `CHART_TOKENS`. [cost-charts.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/cost-charts.tsx:160)

- **F8 — P2 — reasoned — reporting.** The shared `readJson` helper writes the first 300 characters of malformed/non-JSON responses to the administrator’s local browser console. If a malformed successful costs response still contained cube data, an own-article slug could therefore appear there. Normal successful responses and all declared route errors do not do this; changing the shared logging policy is wider than this stage.

- **F9 — P2 — established — reporting.** A renamed administrator-owned article may still receive an arbitrary historical slug as its label or metadata destination because cube row order does not identify the current slug. Totals and ownership remain correct; stage 1 already identified the missing server-side fact.

- **F10 — P2 — established — reporting.** `AdminCostsPage.tsx` is now 932 lines. Its sections are readable, but further features should split the headline, ranking, pivot, and URL-state machinery rather than extending the component again.

### Privacy, state, chart and boundary conclusions

Cost-page URL state contains owner IDs and opaque article keys, never fetched emails or slugs. The document title is constant, nothing in this page writes those values to `localStorage`, and another owner’s article is never linked. The administrator’s own metadata link intentionally uses their own slug, as allowed by the plan.

Back/Forward restores period and scope. Sort changes enter the URL. Stale period responses are dropped. Missing filter values remain visible and removable. The pivot, folded columns, chart table, scope switch, filters and periods reconcile to the headline.

The chart has an accessible image name; its legend appears for two or more series; the following captioned table exposes the exact numbers to screen readers. Colours remain stable when filters remove series, text uses neutral colours, and categorical hues intentionally repeat after eight.

The production build emitted `AdminCostsPage-*.js` as a separate 23.23 kB chunk; the main bundle contains only its dynamic loader. The admin-only route test confirms an ordinary reader typing `/admin/costs` gets the shelf.

### Mutation results

- Dividing displayed cost by all calls instead of priced calls failed the new denominator assertion.
- Injecting an email into the address immediately before inspection failed specifically at `not.toContain("@")`.
- Removing the chart’s accessible name initially stayed green; coverage was added and now catches it.
- Reversing the settled/computed/unpriced overlap sentence initially left all three requested suites green; coverage was added.
- Misrouting the costs loader to the admin index left the three requested page suites green, but `admin-only-routes.test.tsx` failed. That boundary is intentionally covered by the router suite.

### Verification

- Requested suites: **3 files, 51 tests passed**
- Admin-only and client-import boundary suites: passed
- Typecheck: all four projects passed; all 3,070 source files covered
- Targeted Biome check: passed
- Client production build: passed
- `npm run typecheck` itself hit the sandbox’s `tsx` IPC `EPERM`; the same script run directly through Node passed.
- No Postgres-dependent suite was run.

### Files changed

- `src/web/AdminCostsPage.tsx`
- `src/web/admin-costs-view.ts`
- `src/web/cost-charts.tsx`
- `tests/admin-costs-page.test.tsx`
- `tests/admin-costs-view.test.ts`
- `tests/cost-charts.test.tsx`

**VERDICT: approve**