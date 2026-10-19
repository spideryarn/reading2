---
reports: spya-kwcn4x
ending: shipped
comment: On a tall screen our button was docked at the far edge, up to 600px from your words. It now sits just past the iPad's own menu. Please try it on your iPad once deployed.
---
# On an iPad, selecting text showed the iPad's menu and no "Highlight or comment" button

Report `spya-kwcn4x` (#607, SPIDERYARN-READING2-JY, queue item `qi-6ybwkegr`), a problem, from Greg
(admin, `feedback-reporter.ts` exit 0, no addenda), 2026-10-18 23:37 UTC, on an iPad, build
`956a2380`, on
`https://www.spideryarn.com/read/rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug?at=spya-g83jsr&margin=1`:

> I tried to select some text on an iPad, and it showed me the iPad text selection menu with cut and
> copy and whatever, but didn't seem to show me any kind of Spideryarn context menu.

**Ending: Shipped**, on `dev`. Plan, evidence and reviews:
[261019b](../plans/261019b-ipad-selection-chip-sits-near-the-words-and-a-finger-is-known-from-touchstart.md).
Earlier work on the same button: the first iPad report
([spya-ma5h9b](261003_0929-highlighting-on-an-ipad-and-highlights-in-quotes.md)) and the iPhone one
([spya-bynh22](261018_0002-iphone-selection-menu-over-our-highlight-button.md)).

- **What we could and couldn't reproduce.** In an emulated iPad (WebKit, several models, both
  orientations, with and without the margin column) the button appeared every time, so the fault
  only shows on a real device. Nothing changed in this code between the iPhone fix and your build.
- **The likeliest cause, and the fix.** The iPhone fix, which was in your build, moved our button to
  whichever screen edge was further from your words, to keep it clear of the iPhone's menu. On a
  phone that is a short way. On an iPad in portrait it can be 600px away, at the far edge, while you
  are looking at the words and the iPad's menu. **Now it sits 80px past the words**, on the side
  with more room, which should clear the iPad's menu, and goes to the edge only when there is not
  that much room.
- **A second, smaller fix.** The button only appears for a selection made by a finger, judged from
  the first event of the touch. What an iPad sends on a long-press has never been measured, so an
  ordinary touch event now also counts as a finger.
- **Not tried on a real iPad.** Neither the cause nor the fix can be confirmed here. **Greg, once it
  is deployed, please select some words on your iPad and say whether the button appears, and
  whether it collides with the iPad's menu.** If it still doesn't appear, the next step is a build
  that records which events your iPad sends, rather than another guess.
