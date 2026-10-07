---
reports: spya-mtajjy
ending: shipped
---
# Topic pills on each article on the shelf

From Greg (admin, proved by `feedback-reporter.ts` exit 0 on the report's production row). This
session had no Sentry sign-in; the words are from that row.

SPIDERYARN-READING2-D6 (`spya-mtajjy`), a suggestion, filed 2026-10-04 22:19 UTC from the signed-in
home page:

> On the logged in home page, for each article show its topic-pills. If there's lots, then maybe
> only show the first three.

**Ending: Shipped.** It is on `dev` and not deployed. Resolve D6; the next feedback sweep does the
Sentry status write.

What we did:

- Each article on the signed-in shelf now shows the topics it is in, on a line under its details,
  in the cards view and in the table.
- Up to four topics are all shown. With five or more, the first three and then `+N`. (Four rather
  than a strict three, because a `+1` takes about the room of the pill it hides.)
- The order is the same as the row of topics above the shelf: broad subjects first.
- The pills are labels. On a card, pressing one opens the article, like pressing the card anywhere
  else. They do not filter the shelf.

Three choices were made for Greg rather than by him, and are written up as questions in the plan:
whether pressing a pill should filter the shelf, whether there should be a way to see the topics
behind `+N` from the card, and whether "the first three" should be the broadest or the finest.

Not touched: the public shelf (`/read/public`, report `spya-mdp0em`), which is still waiting on
Greg ([its note](261004_1000-topic-pills-on-the-public-shelf.md)).

Plan: [261005a](../plans/261005a-topic-pills-on-each-shelf-card-and-table-row.md).
