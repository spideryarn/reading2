# The shelf's search box takes the focus when you arrive

SPIDERYARN-READING2-5E (`spya-vz9r0h`), from Greg (admin). The time in the file name is when this
session picked the report up. The report text came in the brief, because this session had no Sentry
access.

> When I open the logged-in Spideryarn homepage with the shelf, let's put the focus by default on
> the search box.

**Ending: Shipped.** It is on `dev` and not deployed. Resolve 5E; the next feedback sweep does the
Sentry status write.

What we did:

- When the signed-in shelf opens, the cursor is in the search box, so you can start typing at once.
- It does not happen on a phone or tablet, because focusing a box there pops up the on-screen
  keyboard over the shelf.
- It does not happen if the page opened with a search already in it — you are reading results then,
  and a stray key would change your search.
- It does not take the focus from anything else that already has it, and it does not happen if the
  box is off screen (coming Back from far down an article can open the shelf scrolled down).
- The page never scrolls to reach the box.

Assumptions, each the simpler reading: "phone" means the main pointer is a finger (a touchscreen
laptop with a trackpad still gets the focus), and the rule is decided once as the shelf opens.

Plan: [260929g](../plans/260929g-shelf-search-focus-and-metadata-chord.md) § Part A.
