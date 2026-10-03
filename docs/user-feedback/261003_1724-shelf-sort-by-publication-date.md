---
reports: spya-t3es7k
ending: shipped
---
# Sort the Shelf by publication date

A suggestion from Greg, filed from the signed-in homepage and relayed by the Overseer as an admin's
report.

> In the logged in homepage, enable sorting the Shelf by publication date where available. And I
> guess if it's not available, use your judgment about what's best to do. Keep things simple.
>
> — Greg, 2026-10-03 (`spya-t3es7k`)

## What we did

Plan, reviews and the browser check:
[261003m](../plans/261003m-shelf-sorts-by-publication-date.md). What is built is in
[library.md § Sorting the shelf](../project/library.md#sorting-the-shelf).

- **A seventh sort chip, Published**, after Added. Newest first on the first press, oldest first
  on the second. `?by=published` in the address.
- **In Table view the Published column starts hidden**, and the Columns menu turns it on. With it
  showing, the table was wider than the page on a desktop and the row's buttons fell off the right
  edge. While it is hidden, pointing at a title shows the date in its card.
- **The date was already stored**, so there was no migration: it only had to reach the browser.
- **It is the publisher's own calendar day**, printed as a date ("12 Mar 2024") and not as "3 days
  ago".
- **An article with no publication date goes last, whichever way the arrow points**, like a missing
  value under any other sort. A card sorted this way says "no publication date".

## What Greg should know

- **No PDF has a date, so they all sit at the bottom.** Only a web page whose publisher states a
  date has one, and only if it was added or re-extracted since 2026-08-31. Giving papers a
  year is `[Q-published-date-for-papers]` in the session's debrief: a pipeline change, not built.
