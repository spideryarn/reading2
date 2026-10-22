---
reports: spya-ah5ws6, spya-u8stc4
ending: shipped
comment: On dev. Every spine card ends in a key to what the spine is and the colours on it now. Search marks already paint the spine and follow the threshold. Other modes painting it: none for now (Greg, q-je2p9y).
---
# The spine's card keys its colours, and search on the spine

Reports `spya-ah5ws6` (#632, SPIDERYARN-READING2-KX) and `spya-u8stc4` (#633,
SPIDERYARN-READING2-KY), both suggestions from Greg (`feedback-reporter.ts` exit 0 for each, no
addenda when re-read before this note). Overseer queue item `qi-cz29kr96`, session
`fb-spine-tooltip-search`.

> In the tooltip for the Spine, also explain to the user what the Spine means/how it works/what all
> the colours etc connote.

> The search results should show up in the Spine (and stay up to date as you change the threshold).
> And perhaps any other modes that similarly should show up in the Spine.

**Shipped: the key.** Every spine card now ends in one sentence on what the spine is (the whole
article to scale: tinted bands are parts, hairlines are sections; point to read, click to go), then
a small swatch and two words for **each kind of mark the rail is drawing at that moment**: where you
are and what is on screen always, then the search lanes (one swatch per search, in its colour), the
quote strip, time spent reading, where you jumped from and back matter, each only when drawn. The
lane chip, the card's count and each band's screen-reader name now use the open mode's words, so
Ideas no longer says "search matches". `/help/spine` was also corrected: it said Quotes and Skim
draw right-edge lanes, and it never mentioned the quote strip. Plan
[261020e](../plans/261020e-spine-card-explains-the-spine-and-keys-its-colours.md), both GPT Sol
reviews beside it.

**Already true: search on the spine.** It has painted since 2026-08-26 and follows the threshold.
A browser check moved the Prioritised slider to 30, 69, 88 and 92; the list kept 20, 7, 4 and 1
results, and the spine showed the same 20, 7, 4 and 1 marks. Nothing was built for this half beyond
the key, which makes the marks say what they are.

**Asked: the other modes.** A chat answer's search buttons, Ideas and Timeline before a row is
pressed, Glossary, FAQ and Sources do not paint the spine. Which should is a product call, asked in
[q-je2p9y](questions/q-je2p9y.md) together with where Greg saw the search marks missing. Queued as
`qi-bp4ez3yc`, waiting on that answer.
