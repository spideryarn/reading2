---
reports: spya-j78fff
ending: shipped
---
# Reopening a recent article from the shelf: preloaded

Report `spya-j78fff`, a suggestion, from Greg (admin), 2026-09-29, on `https://www.spideryarn.com/`,
relayed by the Overseer as queue item `qi-knrdvcxk`:

> We have talked in the past about trying to make Spideryarn work entirely offline, and I would still love that. But my sense was that it would actually potentially incur quite a lot of complexity, and so if that's still true, let's hold off. That said, I wonder if there are ways in which we could just make it slightly snappier. So, for example, if I've been reading an article and then I click to go back to the home page, and then I click on the article again, it still takes a few seconds to load, and that's okay. But if there are ways to make it faster to load that don't create lots of complexity or risk of staleness or weird visual artifacts, I don't know if some kind of short-term caching or browser caching, I don't know. I'm always very wary of these because they can create weird bugs and problems. But if you see a clean way, a clean and general way to just improve a few of the most obvious things that take a while to load, you know, that would be great. Like, for example, you know, when I go to the home page, it would be great to sort of preload somehow the top five articles if they haven't already been loaded and refresh them if they have, so that if I click any of the top five articles in my shelf that they, you know, or the most recently opened articles in my shelf, that they load effectively instantly. Like, that would be cool so long as it doesn't create too much complexity or risk of bugs.

**Ending: Shipped**, on `dev`. Plan
[261003d](../plans/261003d-preload-recent-shelf-articles.md), with GPT Sol's plan review and code
review beside it.

What changed: whenever the shelf is on screen, it fetches the five articles opened most recently.
Every visit to the shelf refreshes them. Opening one of them uses that answer instead of waiting on
the server, and the server is where the seconds were. The preload is kept in memory only, and it
cannot show an old article:

- it is used once
- it lives a minute
- any edit throws it away
- it goes only to the reader it was fetched for
- it is drawn once, with no stale-then-fresh repaint

The extra cost is five article requests per shelf visit, skipped when the browser is in save-data
mode.

Offline is still held off, as asked: it is still the complex part
([260827r](../plans/260827r-offline-reading.md), slices 3–5). Nothing else the report asked for is
left unbuilt.
