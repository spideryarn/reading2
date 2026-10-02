# Citations: order the cited works by publication date

Admin suggestion, report `spya-xpxmjn`, Overseer queue item `qi-5e2wzg9m`. Owning doc:
[citations.md](../project/citations.md) § The orders, and the bar.

> In Citations mode, add a `sort` option for publication-date.
>
> — Greg, 2026-10-01

## What we have

A cited work carries a `year` — a free string from the model (`"1932"`, `"2017a"`, `"n.d."`,
`"in press"`) — and, where the article left it empty, the bibliographic registry's numeric year
(plan 261001a stage 5). `workByLine` in `src/web/CitationsPanel.tsx` already decides which one a
row draws. Nothing finer than a year exists for most works, so "publication date" is a year.

The list has four orders today (`CITE_ORDERS` in `src/web/params.ts`, `?citeby=`): prioritised,
first cited, relevance, influence. Debate already has a `date` order
(`src/web/debate-order.ts`): **oldest first, same year in the existing order, undated last**.

## The change

- **A fifth order, `date`**, key `?citeby=date`, button label *date*, after *influence*.
- **The year it sorts by is the year the row draws** — `workByLine(work).year`, the article's own
  where it gives one, the registry's otherwise — so the order can never disagree with what the
  reader sees on the row. A four-digit year is read out of that string (`2017a` → 2017,
  `2019–2020` → 2019); a string with none (`n.d.`, `in press`) is undated.
- **Oldest first**, as Debate's date order is — one convention across the two modes, and it reads
  as the history of the idea. Same year: first-cited order. Undated: last, in first-cited order.
- **The button appears only when at least one work has a year**, as relevance and influence appear
  only when some work has that score (`orderOptions`).
- **`effectiveOrder` falls back to *first cited*** when `?citeby=date` arrives for a list with no
  year at all, so the pressed button always names an order the list honours (FAQ's rule in
  `faq-order.ts`; the score orders do not do this today and are left alone).
- Docs: citations.md's order list and url-state.md's `citeby` row.

## Simpler option passed over, and what is deferred

- **No direction toggle.** Newest-first is a second button or a toggle; one order is the simplest
  version and matches Debate. Deferred until somebody asks.
- **No date marker** like Debate's "this article's year" divider. Deferred.
- **Not reaching for a month or day** from the registry: it holds only a year.

## Tests

In `tests/citations-panel.test.tsx`, written red first: ordering with mixed article years, a
registry-filled year, `2017a`, `n.d.`, ties keeping first-cited order, undated last; the `date`
button absent with no years and present with one; `effectiveOrder` falling back.

## Reviews

GPT Sol's plan review ([prompt](261002j-citations-sort-by-date-plan-review-prompt.md),
[answer](261002j-citations-sort-by-date-plan-review-sol.md)), two P3s, both taken: the year is any
four-digit run 1000–9999 as Debate's `readPublishedYear`, not 1000–2099; and rendered tests for the
owner's list in date order (pressed button, no threshold) and a visitor's, registry year included.
