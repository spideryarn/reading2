# Code review: an end-of-article mark, and the publication date on the Shelf card

You are reviewing two small commits, the last two on this branch (`git log -2`, `git show HEAD~1`,
`git show HEAD`). The plan is
`docs/plans/261005e-an-end-of-article-mark-and-the-publication-date-on-the-shelf-card.md`; your own
plan review is `docs/plans/261005e-end-mark-and-shelf-date-plan-review-sol.md`.

You may edit files in this worktree. **Fix what is inside these two changes**, narrowly, and for a
real defect write the test that reproduces it and see it fail before you fix it. **Report, do not
fix, anything wider** you notice. You cannot commit; leave your changes in the working tree. Do not
touch files outside these two changes' scope, and do not reflow or reformat anything.

The two changes:

- **A.** `src/web/TableView.tsx` draws a `<tfoot>` with one `td.article-end` after the last block;
  styles at the end of `src/web/styles/prose.css`; test `tests/article-end-mark.test.tsx`; a
  paragraph in `docs/project/typography.md`.
- **B.** `src/web/ShelfEntry.tsx` § `ShelfCard` adds `publishedOf(entry)?.label` to the facts line;
  test `tests/shelf-card-published.test.tsx`; a section in `docs/project/library.md`.

What to check, in order of weight:

1. **A footer row in a table everything else treats as rows of blocks.** Find every place that
   walks or measures this table or its rows (`src/web/scroll.ts`, `selection.ts`, `flash.ts`,
   `layout.ts`, `fold*.ts`, the spine, reading position, reading time, keyboard movement, the
   marginalia column, the touch selection chip, print styles) and say for each whether the new row
   can be mistaken for a block, change a measurement, or break a selector such as `tr:last-child`,
   `tbody > tr`, `td` or `tr` without `[data-block]`. Name file and line for anything real.
2. **The styles.** Does `td.article-end` inherit anything unwanted from a rule on `td`, `table.zoom`
   or `.reader`? Is it centred on the same axis as `.prose` in every layout the stylesheet has
   (plain, a band mode, a phone, a note region, a callout)? Any stacking, sticky or background
   problem? Is it visible in both themes?
3. **The Shelf card.** Any case where the facts line prints something wrong or duplicated, loses a
   fact, or breaks its layout; whether the key change is right; whether the public shelf or the
   Table view was changed by accident.
4. **The tests.** Would each one fail if the feature were removed or put in the wrong place? Is
   there an obvious case missing that is cheap to add?
5. **The docs** say what the code does, and nothing in them is attributed to Greg that he did not
   write. His only words here are the two quoted reports in the plan.

Run `npx vitest run tests/article-end-mark.test.tsx tests/shelf-card-published.test.tsx` and any
one neighbouring test file you think is at risk. Do not run the whole suite.

Answer with a verdict first (ship / ship with the fixes made / rework), then numbered findings
ranked P0 to P2 with evidence, then a list of exactly what you changed. Say plainly if you found
nothing.
