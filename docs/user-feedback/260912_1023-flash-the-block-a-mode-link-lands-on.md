---
reports: spya-jk5qxu
ending: shipped
---
# Flash the passage a mode's link lands on

`spya-jk5qxu`, 2026-09-12 10:23Z, from Greg (admin). It never got a note, so the Earlier tab showed it
as not shipped. The words below were read from its row in production on 2026-10-01.

> When I click on the block from a mode (e.g. for a citation or quote or idea or summary or others),
> it should somehow briefly highlight that block (or better still the particular part of the block
> that's relevant - this is most obvious for a citation, e.g. if I click on a block-link from a
> citation, highlight the citation itself for a couple of seconds

**Ending: Shipped**, and deployed since.

When a link in any mode takes you to a block, the block now flashes once the scroll arrives. The
flash is in the one function every jump goes through, so every mode gets it. `62e1a7f2`;
[260928b](../plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md).

**The "better still" half was done for Citations only.** A Citations row's *first cited* now shows
the words that cite the work, and clicking it flashes those words, not the paragraph
([260930_1545](260930_1545-citations-name-the-citing-words-and-read-the-pdf-reference-list.md)).
Links from Quotes, Ideas, Summary and the other modes still flash the whole block.
