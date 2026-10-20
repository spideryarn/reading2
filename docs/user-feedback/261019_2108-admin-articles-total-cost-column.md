---
reports: spya-vjyev3
ending: shipped
---
# `/admin/articles` shows each article's total cost

SPIDERYARN-READING2-MG (#651), a suggestion from Greg (an administrator; `feedback-reporter.ts`
exit 0), filed 2026-10-19 21:08 UTC from `https://www.spideryarn.com/admin/articles`. Queue item
`qi-c32nvwg4`.

> Also show Total Cost per article
>
> — Greg, 2026-10-19

**Shipped** on `dev`. The table has a **Total cost** column: every model call the ledger ties to
the article by id, over its whole life. It uses `/admin/costs`' rule and formatting, with `+` for a
floor and `—` when nothing was priced. There is also an order select, *Highest total cost first*.
No new stored field. Plan, reviews and the production measurement behind the id-only rule:
[261020s](../plans/261020s-total-cost-column-on-admin-articles.md).
