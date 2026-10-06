# Code review: focusable sideways scroll boxes (qi-t2ee3kyx)

You are the stage's code reviewer and you may write. **Fix what is inside this stage, narrowly and
red-first** (a failing test before each fix). **Report, do not fix, anything wider.** Do not commit.
Do not attribute any words to Greg in a doc or comment unless you are copying them from a file
already in the tree.

## The candidate

- Commit `3f8446a87` on top of base `a680cc53b447ef9833e03574125bda294aa9ec20`:
  `git show 3f8446a87` / `git diff a680cc53b 3f8446a87`.
- Changed paths, complete:
  `src/web/lib/SidewaysScrollBox.tsx`, `src/web/lib/DataTable.tsx`, `src/web/AdminVouchersPage.tsx`,
  `src/web/AdminCostsPage.tsx`, `src/web/cost-charts.tsx`,
  `tests/sideways-scroll-box.test.tsx`, `tests/admin-vouchers-page.test.tsx`,
  `tests/admin-costs-page.test.tsx`, `tests/eager-client-graph.test.ts`,
  `docs/project/web-client.md`, `docs/project/admin-costs.md`,
  `docs/plans/261006h-focusable-sideways-scroll-boxes.md` (+ its plan-review prompt and answer).
- Start with `SidewaysScrollBox.tsx` and the plan; that does not limit scope. Read the call sites
  (`Library.tsx`, `AdminPage.tsx`, `AdminCostsPage.tsx`, `scripts/cost-analysis-chart.ts`), not only
  the component.

## What to do

Attack the code independently first. Run `npx vitest run tests/sideways-scroll-box.test.tsx
tests/cost-charts.test.tsx tests/cost-analysis-html.test.ts` yourself (they need nothing outside the
tree). I have run, green: those plus `tests/admin-vouchers-page.test.tsx`,
`tests/admin-costs-page.test.tsx`, `tests/eager-client-graph.test.ts`, `tests/doc-links.test.ts`,
and `npm run typecheck`. Mutations I ran: `any = right` failed two tests; dropping `tabIndex` failed
eight.

The plan narrowed its own claim after your plan review (its § GPT Sol's plan review). The statement
to judge now is:

> After this commit, every **table** scroll box drawn through `SidewaysScrollBox` or `DataTable`,
> the vouchers table's box, and the `/admin/costs` per-day chart's box in the live page, takes
> keyboard focus while and only while its content is wider than it, with `role="region"` and an
> accessible name; nothing else about how the shelf or `/admin/users` table is drawn has changed;
> and the static cost report still renders.

Is that statement accurate? Also read the two doc edits and the plan's "What landed" as a reviewer
of the conclusions, and correct any sentence the code does not bear out.

## Severity and IDs

P0 data loss / security / charging / broadly unusable. P1 user-visible wrong behaviour or an
authoritative contract violated. P2 design or maintainability risk, no wrong behaviour today.
P3 prose defect. Refuse only on an *established* P0/P1 that you could not fix. Continue the plan
review's numbering: new findings start at `F4`. For each: severity, established or reasoned, and
whether you fixed it (with the test you saw red). End with ACCEPT or REFUSE on one line.

## My own suspicions (already mine; spend most of the run elsewhere)

- `{...box}` spreads a `ref` inside a props object onto a `div` (React 19 ref-as-prop). Is that
  sound for both the component and `StackedDayChart`'s `box` prop, including under
  `renderToStaticMarkup` in the script?
- An element whose `role`/`tabIndex` appear and disappear on resize: can focus be lost in a way that
  matters?
- The sentence I would least like to be wrong: "nothing else about how the shelf table is drawn has
  changed".
