# Code review: a total-cost column on `/admin/costs` and in Metadata

You reviewed the plan for this work; this is the review of the code built from it. You may fix what
you find **inside this change** (the files below) and must report anything wider instead of fixing
it. Do not commit, do not push, do not touch `.env.local`, and run no git command that discards work.

Read:

1. `docs/plans/261006j-total-cost-column-on-admin-costs-and-metadata.md` — the plan, including
   § GPT Sol's review of the plan, which says what was done with each of your findings. Finding 2
   was **not** taken; say whether the answer given there holds up.
2. The change itself: `git diff HEAD` (nothing is committed yet), and the untracked files
   `git status --short` lists under `docs/plans/261006j-*`.
3. `docs/project/admin-costs.md` § The rules the figures keep.

The files of the change:

- `src/web/AdminCostsPage.tsx` — the ranking's `amount` column: header, `meta.label`, hint, caption
- `src/web/ArticleCost.tsx` — the Metadata table's last heading
- `tests/admin-costs-page.test.tsx`, `tests/article-cost-section.test.tsx`
- `docs/project/admin-costs.md`

Please check, against the code and not against the plan's prose:

1. Is every claim in the new hint text true of `recordedNanos` and of the headline figures above
   the table (`Recorded ledger amount`, `Estimated cash`)? Do the rows of the ranking really add up
   to the headline recorded amount in every grouping and under every filter?
2. Does anything else on the page, in another test, in a browser test, in a doc or in the help page
   still name this column by its old heading in a way that is now wrong? (The pivot, the chart, the
   headline and `npm run cost:analyse` keep "recorded amount" on purpose.)
3. Is the new `aria-sort` assertion a real check of the resting sort? It was seen red by setting
   `DEFAULT_SORT` to `["calls"]`. Is there a way it passes while the resting sort is wrong?
4. `tw:whitespace-nowrap` on the Metadata heading: any way it pushes the table out of its card on a
   narrow window?
5. Anything in the comments or the doc line that is inaccurate, or that says more than the code does.

Run `npx vitest run tests/admin-costs-page.test.tsx tests/article-cost-section.test.tsx tests/doc-links.test.ts`
and `npm run typecheck` after any fix.

Write the findings as a numbered list, each with a severity (P1 blocks, P2 should fix, P3 note), the
file and line, whether you fixed it, and what is left for me. End with one line that is exactly one
of:

`VERDICT: approve` · `VERDICT: approve with changes made` · `VERDICT: changes needed`
