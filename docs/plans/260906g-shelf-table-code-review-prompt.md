# Review prompt: the shelf table code, as built

You reviewed the **plan** for this work earlier
(`docs/plans/260906g-shelf-table-review-sol.md`). This is the second review, of the **code that was
built from it**, and it is the one that matters more — a plan-stage review cannot see a `PATCH` that
writes one field and then rejects the request.

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-looks`

**The scoped diff is one commit:**

```
git show 601a550a
```

Read that, plus the files it touches and these for context:

- `docs/plans/260906g-the-shelf-table-is-ugly-because-the-reading-view-s-css-leaks-into-it.md` — the plan as revised after your first review
- `docs/postmortems/260906g-an-unscoped-element-selector-in-styles-css-reached-every-table-in-the-app.md`
- `src/web/TableView.tsx` and `src/web/useColumnContext.ts` — the reading view, which the CSS change must not have broken
- `src/web/AdminPage.tsx` — `DataTable`'s **other** consumer, which this change also affects
- `AGENTS.md` — house rules

## What was measured, so you do not have to take it on trust

- Shelf header/first-row overlap: **32.5px → 0px**, at scrollY 0 and 400. `td` `border-right` gone.
- 390px article column: **53px → 224px**; the table scrolls rather than crushing.
- The guard was verified by reintroducing the bug: it reported all four violations with line numbers
  that point at the real rules.
- The row cap was verified by temporarily setting it to 10: 10 rows + "Show all 30 articles" →
  click → 30 rows, button gone.
- The switch: `role="radiogroup"`, one tab stop on the root, ArrowLeft moves focus **and** selection
  and the cards view actually renders, rich tooltip opens, no `title` attribute.
- 20 relevant test files, 212 tests, all green. `npm run typecheck` clean for `src/web`
  (`tests/dock-corner-controls.test.tsx` has 2 pre-existing `navLabelStatus` errors from other work
  on `dev`, in a file this commit does not touch).

## What I most want from you

1. **The CSS change, hardest.** `:where(table.zoom > thead) > tr > th` and
   `:where(table.zoom > tbody > tr) > td`, plus the same scoping in the two transition rules.
   - Does this change the reading view's rendering **in any way at all**? Specificity, cascade
     order, the pinned end columns (`pin-left`/`pin-right`), `useColumnContext`'s measurements,
     `td.gist .sticky`, the `--head-h`/`--bar-bottom` arithmetic.
   - Is the child-combinator chain right against the real DOM `TableView.tsx` emits — including
     `colgroup`, the `rowSpan` cells, and the `withheldLeaf` cell?
   - Did removing `.design-table td { border-right: 0 }` leave the design page correct?
   - Is there any element that WAS being styled by the old bare rules, in the reading view, that is
     now not? That is the regression I am most worried about and least able to see.

2. **`tests/table-selectors-are-scoped.test.ts`.** Is the parser right? It blanks comments to keep
   offsets, tracks brace depth for `@keyframes`, and splits selector lists on top-level commas only.
   What CSS would it get wrong — nested `@media`, `@supports`, `@layer`, a string or url() containing
   a brace, CSS nesting with `&`? Does any of that matter for this file, and is the failure mode
   safe (false green vs false red)?

3. **`DataTable` changes** — `CELL_X`, `FLUID_CELL`, `FIXED_CELL`, and `min-w-56` on both the header
   and the body cell. Does the `min-w` interact badly with `w-full max-w-0` in any case I have not
   hit? What does this do to `/admin`'s table, which has different columns?

4. **The row cap in `Library.tsx`.** Sliced after both `sinkLast` passes. Is the seam right, is
   `expanded` in the right place, and is there a case where the reader ends up looking at a capped
   list with no button, or a button that lies about the count?

5. **`ShelfControls.tsx`'s `ViewSwitch`.** Radix `RadioGroup` wrapped in our Floating-UI `Tooltip`,
   which clones the trigger and merges refs. Is that composition sound — does the tooltip swallow
   anything Radix needs, or vice versa? Is `sr-only sm:not-sr-only` the right way to do the
   responsive label, and does the accessible name stay correct at both widths?

6. **Anything I have got wrong, or any risk not named.** Be specific, cite `file:line`, and separate
   what you are certain of from what you are guessing. Three real findings beat twelve maybes.
