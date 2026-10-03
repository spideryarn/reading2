---
reports: spya-xpxmjn
ending: shipped
---
# Citations: order the cited works by publication date

Greg's suggestion from the Feedback dialog (he is admin), filed 2026-10-01 on a Citations view, queued
by the Overseer as `qi-5e2wzg9m`. Not built before (checked `git log origin/dev`, `docs/plans/`, this
directory, `gjd-remote ls` and the queue on 2026-10-02).

> In Citations mode, add a `sort` option for publication-date.

**Shipped.** A fifth order button, *date* (`?citeby=date`): oldest first, same year in first-cited
order, works with no year last — the convention Debate's date order already uses. It sorts by the
year the row shows, so the order never disagrees with the by-line. The button appears only when some
work has a year. Plan, and GPT Sol's plan and code reviews:
[261002j](../plans/261002j-citations-sort-by-publication-year.md).

Not built, and not part of what was asked: a newest-first direction, and a marker for the article's
own year. Either is a small follow-up if wanted.
