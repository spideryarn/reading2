---
reports: spya-k8mka5
ending: shipped
comment: /admin/articles and the Given table on /admin/vouchers now use the same table as /admin/users: sort by any header, hide columns, first column held. Library: TanStack Table, already ours; the v9 upgrade is queued.
---
# The admin tables sort and hide columns, on one shared table

An administrator's suggestion (`feedback-reporter.ts` exit 0, no addenda), report #670, filed from
`/admin/articles` on build `804e055b`:

> It looks like the way we're displaying the table here is different from the way we're displaying
> the table in /users. And the /users one, I think perhaps it was more functional?
>
> Either way, I feel like we should find a really good library for displaying tables that allows you
> to sort columns and maybe hide columns, and perhaps be using that throughout.
>
> see third-party-library-selection.md etc
>
> — Greg, 2026-10-21 15:53 UTC (`spya-k8mka5`)

**Ending: Shipped** to `dev`, not deployed. Plan, with GPT Sol's plan review and both stages' code
reviews: [261021i](../plans/261021i-admin-tables-share-one-sortable-hideable-table.md).

- **The library**: the selection was re-run
  ([261021a](../research/261021a-table-library-for-sortable-hideable-columns.md)), and the answer is
  the one we already had: TanStack Table, headless, behind `src/web/lib/DataTable.tsx`, which is
  what makes `/admin/users` "more functional". No new dependency. Staying on v8 for now; the move to
  v9 is queued as its own piece of work (Overseer queue `qi-xznd63pe`, a proposal).
- **`/admin/articles`** is now that table: every column sorts from its header (shift-click adds a
  second key), columns hide from the Columns menu or a right-click, the Article column is held, the
  sort is in the address and the hidden columns are remembered. The order `<select>` is gone; Total
  cost is one click.
- **`/admin/vouchers`, Given tab**: the same, through a small escape hatch (`renderRow`) because a
  voucher row turns into a form. A half-edited voucher keeps its draft when the table re-sorts.
- **Not moved**: the `/admin/costs` pivot and failure tables, whose fixed orders are the point of
  them, and `/admin/feedback`, which is cards. Say if you want any of them sortable.
