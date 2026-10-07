---
reports: spya-eqcbay
ending: shipped
---
# Search results squeezed on a landscape iPad

Report `spya-eqcbay` (SPIDERYARN-READING2-BP), a suggestion, from Greg (admin, production row
proven), 2026-10-03 19:17 UTC, from Search mode on `/read/arxiv-2610-spya-bfrbaj`, relayed by the
Overseer (queue item `qi-4zsj3w9g`):

> When I use the search on a landscape iPad, I can hardly see the search results. They're just in a
> tiny little window at the bottom, scrollable window, because of all the stuff above them that is
> taking up space. So there's a few options. One simple one would be to actually just scroll the
> entire column as one. Another would be to reduce the space given to the different other searches
> for their scrollable window. I think most importantly of all, let's remove some of the stuff we
> don't need. So there's something underneath the threshold for prioritize that says nothing is
> hidden by this threshold. We can get rid of that, I think, because the, you know, n of m above
> kind of answers that. And there's also a blurb explaining, you know, what the scoring and the
> visual bars are. Let's rely on tooltips for that, so we can get rid of that as well.

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261003p](../plans/261003p-search-results-get-the-room-on-a-landscape-ipad.md). The Sentry status
write is the next sweep's (this session has no Sentry sign-in).

## What changed

- **The blurb explaining the score and the bar is gone.** Tap (or point at) the number at the left
  of a result and a card says the same thing in words.
- **"Nothing is hidden by this threshold." is gone.** When the threshold *is* hiding something the
  line still appears (*"8 passages are hidden by this threshold. Drag the slider left to show
  them."*).
- **The saved searches' scrolling window is smaller**: a quarter of the column, down from 40%.
- Measured at iPad-landscape sizes with five saved searches on: the results went from 116px to
  305px tall (1180×740) and from 86px to 268px (1024×690). No whole result fitted before; one or
  two do now.
- **A bug found on the way, and fixed:** in Chrome with touch on, a tap on a result's number opened
  the card and it shut again a fraction of a second later, so on a touch screen it could not be
  read. With the blurb gone that card is the only explanation, so it had to work. Fixed in the
  shared tooltip; [postmortem 261004a](../postmortems/261004a-input-modality-must-expire-with-the-interaction-it-qualifies.md)
  is what GPT Sol's review then caught in my first fix.

## Not done, and why

- **Scrolling the whole column as one** (your other option) was not needed to get the room back at
  iPad size, and it would take the search box and the order buttons off screen as you scroll. It is
  the likely answer for a phone held sideways, where the results are still only 10px tall (they
  were before this, too). That is queued separately as `qi-ddddtaqm`, a proposal.

## For Greg

1. **Please tap a result's number on your iPad** and check the card stays up. The bug was reproduced
   and fixed in Chrome's touch mode; nothing here can run Safari with touch.
2. **The same "Nothing is hidden" line is still under the sliders in Glossary, Quotes, Citations,
   FAQ and Debate**, where *n of m* also answers it. Left alone because the report was about
   Search. Say so and it goes from all of them.
3. **The line when something *is* hidden** was kept in Search. *n of m* arguably covers that too;
   dropping it would give the results another 40px when the threshold is hiding things.
