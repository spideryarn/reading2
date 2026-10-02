---
reports: spya-f28vqj
ending: shipped
---
# A paper card on the article links under each shelf topic

Report `spya-f28vqj`, a suggestion, from Greg (admin), 2026-09-29, on
`https://www.spideryarn.com/?topicsView=detail`. The first half of it shipped on 2026-10-01 in
`7ce6b35bc` ([261001_1200](261001_1200-five-small-tooltips-and-labels.md)): the count bar's card,
*N of M* removed, narrower bars. This note is the rest, which that note passed on and nothing took
until the 2026-10-02 re-check of every report put it in the Overseer's queue (`qi-srbwnnzz`):

> And also: add rich tooltips (see `tooltips.md`) to the paper-links that are matched for each
> faceted-text-search-pill. In fact, better still, maybe create a reusable component for
> paper-tooltips that we use anywhere there's a link to a paper that shows title, authors, metadata
> (e.g. when added, when last opened, faceted-text-search-pills, and maybe some kind of preview or
> summary).

**Ending: Shipped**, on `dev`, not deployed.

What we did: a reusable **paper card** (`src/web/PaperCard.tsx`). It shows the title, the authors and
site, and the one-sentence gist as the preview (or the abstract, cut short, for a paper not yet
AI-processed). Then when it was added and last opened, its length, whether it is archived or
shared, and the shelf topics it is in, each with its colour dot. It opens on hover and on keyboard
focus over every article link in the topics' *More detail* view. It takes a shelf entry and the
topics to name, so the next place that links to a paper can use it as it is. Plan, reviews and
screenshots:
[261002f](../plans/261002f-paper-card-on-topic-article-links.md).

Not done, and named in the plan: the card on the shelf's other links (the cards view, the table,
which has its own row card, `/read/public`, links between articles), and a tap-to-reveal on touch.
A tap follows the link, as the table's titles do.
