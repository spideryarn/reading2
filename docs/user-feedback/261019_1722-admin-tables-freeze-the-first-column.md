---
reports: spya-t45cfc, spya-zzewu7
ending: shipped
comment: Every /admin table now keeps its first column on screen while it scrolls sideways — Account on /admin/users, Article on /admin/articles, Email on /admin/vouchers, and the label column of all four /admin/costs tables.
---
# The /admin tables keep their first column on screen while they scroll sideways

Two admin reports from Greg (`feedback-reporter.ts` exit 0 on both), suggestions, both 2026-10-19:
`spya-t45cfc` (#619, `SPIDERYARN-READING2-KC`) at 17:22 UTC from `/admin/users`, and `spya-zzewu7`
(#643, `SPIDERYARN-READING2-M5`) at 20:33 UTC from `/admin/articles`. Overseer queue item
`qi-cf3vgy3m`.

> When I scroll the table, can you keep the first column, which shows the name, frozen/visible the
> whole time?
>
> — Greg, 2026-10-19, `/admin/users`

> When scrolling this table to the right, keep the first column frozen (article name) so that it's
> always visible.
>
> We have made the same point about the user column in /admin/users - consider whether there are
> any other columns in tables in /admin/* that also should freeze the first column.
>
> — Greg, 2026-10-19, `/admin/articles`

**Ending: Shipped**, on `dev`. Plan
[261019o](../plans/261019o-admin-tables-freeze-the-first-column.md).

Which tables, answering the second report's question: all of them. Users, articles and vouchers
were frozen now. On `/admin/costs` the pivot and the failures-by-day and by-task tables already
were. The ranking and the "Why attempts failed" table joined them, the latter because it is the widest
on the page. `/admin/feedback` is cards, not a table. The shelf (`/read`) uses the same table
component and was left alone, since it was not asked for; it is one prop (`pinFirst`) if wanted.

On a phone the frozen column is narrower (160px of a 325px box), so the rest still has room to
scroll. Hovering a row and the row marked by `?user=` tint the frozen cell too. Checked in a browser
at 390px and 1000px, light and dark; GPT Sol reviewed the plan and the code.
