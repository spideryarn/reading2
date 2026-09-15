# The shelf's actions could not be found on an iPad

**[SPIDERYARN-READING2-40](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-40)** · reported
2026-09-12 12:17 UTC · kind: suggestion (handled as a bug) · from an admin (Greg) · *shipped*

## What the reader said

> We have a few options that we can apply to articles on the shelf in the logged-in homepage, like
> archive and rename the title and a couple of others that I can't remember. On an iPad or other
> touch device, there didn't seem to be a way to access them. So maybe we could set it up so that you
> have to double-click the article to open it, and one click shows these options, or add a drop-down
> button to display them, or something else that makes them available on the logged-in homepage shelf
> on a touch device.

Build `d358f773`, iPad.

## What we found

**In the card view the five buttons would have been on screen, and they did not work the way they
were meant to.** On an iPad they sit in the corner of every card as five small grey icons with no
words. Each was meant to show
what it does on the first tap and do it on the second. But since iOS 18.2 a tap tells the page it was
a mouse click (a WebKit bug that is still open), so the first tap acted at once, and the two buttons
that can be unavailable did nothing and said nothing. In the table view in portrait, Archive was also
cut off the right edge.

## What we did

**Shipped on `dev`:** on any device with a touch screen, each card now has one "⋯" button. Tap it
and the five actions appear as a list of words: Edit title, Re-fetch and rebuild, Open the original
page, Copy link, Archive. A tap on a word does it. If one can't be used for that article, it is
greyed out and says why. The table view gets the same button, which also stops Archive falling off
the edge in portrait. With a mouse and no touch screen, nothing changes: the icons still appear when
you point at a card.

The "⋯" is larger than the old icons, and a finger that starts scrolling on it doesn't open the
menu. A touchscreen laptop was also fixed, where the icons had been invisible to the finger.

**Not yet on production**, which is Greg's to deploy. It needs a real iPad to confirm: tap "⋯",
choose each item, and scroll the shelf starting on a "⋯".

**One thing for Greg, not fixed here.** The iOS bug above also affects the left-hand rail in the
reading view. Tapping one of its bands is meant to show the band's card first and move on the second
tap. On an iPad it probably moves at once. The link and glossary cards may be affected too. Each
belongs to its own area; the plan's § Wider section names all three.

[The plan](../plans/260915b-shelf-actions-reachable-on-touch.md)
