---
reports: spya-db7w6f
ending: shipped
---
# The Metadata page says how long you have spent reading the article

Report `spya-db7w6f` (#702), from Greg (`feedback-reporter.ts` exit 0, no addenda when re-read
before this note), on `arxiv-2308-08708-spya-xax6v4`. Session `fbdb7w6f-metadata-time-spent`.

> In that metadata section for an article, can you provide an estimate of the amount of time spent
> reading the article by the user?

**Shipped, on `dev`.** The Metadata page's *Your reading* card has a third row, **Time spent
reading**, under *Where you left off*: "about 3 h 25 min", with a faint line saying it counts the
time the article was on your screen while you were active. It is the reading time the spine
already draws, added up across the whole article. Only the owner sees it. A shared or public view
doesn't have it, and an administrator viewing as another reader sees "Not shown". Plan:
[261024t](../plans/261024t-metadata-shows-time-spent-reading.md).
