---
reports: spya-dfghb4, spya-mghbv7
ending: shipped
---
# Clicking a Sketch or an Illustrated plate should enlarge it

Two feedback rows from Greg (admin), in production, both in Diagram. No Sentry issue for either:
neither row was mirrored, so there is no status to write.

`spya-dfghb4` (2026-09-05 07:58 UTC, build `31382bf2`, `lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz`):

> If I click on the Sketch or Illustrated images in Diagram, that should be equivalent to clicking
> on Enlarge button for them.

`spya-mghbv7` (2026-09-11 13:12 UTC, build `607b57a0`, `temporal-context-reinstatement-spya-dhqkf9`):

> When I click or double-click on a diagram (e.g. Illustrated, or perhaps on the background of a
> Sketch), it should Enlarge it.

**Ending: Shipped** — on `dev`, not deployed (`b41bd6c3`, review fixes in `d1e16d76`).

What we did: in the band, a press on an Illustrated plate, or on a Sketch's background, does what
Enlarge does, with a zoom-in cursor to say so. A Sketch node still selects and a region's name still
opens its scene; the keyboard way in is still the Enlarge button. A double-click no longer opens and
then shuts the overlay: the overlay ignores the second click of one, wherever it lands (the browser
pass caught it landing on a row that closes the overlay and jumps the article).
[261001l](../plans/261001l-compact-quotes-and-citations-band-tops-and-click-a-diagram-to-enlarge.md).
