---
reports: spya-bynh22
ending: shipped
comment: Our button now docks at the top or bottom edge, away from the iPhone's menu. Hiding the iPhone menu isn't possible from a web page. Please try it on your phone once deployed.
---
# On an iPhone, the iOS selection menu sat on top of our "Highlight or comment" button

Report `spya-bynh22` (#601, SPIDERYARN-READING2-JQ, queue item `qi-83gpbgyg`), a problem, from Greg
(admin), 2026-10-18 00:02 UTC, on an iPhone, on
`https://www.spideryarn.com/read/rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug?structure=expanded&at=spya-zmpdet&learn=quiz&term=spya-yx3qja`:

> I tried to select some text on an iPhone, and I could see the iPhone, like, default standard menu
> for copy and other stuff on top, and I could see there was something underneath it. And if I
> clicked, you know, somewhere on the text, the iPhone menu disappeared, and I could see the
> Spideryarn menu to highlight or comment was still there. So it feels like that's not quite working
> the way that we want it to. It's tricky because actually the iPhone menu might be useful. I might
> want to copy or translate or whatever the standard iOS options are. At the same time, I might want
> to use the Spideryarn context-specific stuff to highlight or comment. I don't know. I guess we
> could do an offset so that both are present. That seems—well, I can't decide if that's elegant or
> ugly. Alternatively, well, the most important thing I'd want to do is probably, from the iPhone
> menu, is probably copy, or as in copy and paste to the clipboard. So it may be that we add that to
> our Spideryarn context menu and then try and override the iOS-specific menu so that it doesn't
> show, if that's not possible. Well, let's look on the web whether there are any best practices or
> suggestions. Do your best to try and reproduce things and see if you can figure out a good
> solution. But let's not create too much complexity. We want to keep things simple if we can.

**Ending: Shipped**, on `dev`. Plan, research and reviews:
[261018c](../plans/261018c-touch-selection-chip-docks-away-from-the-ios-callout.md).

- **Why it happened.** Our button sat just under the selected words. iOS puts its own menu above
  the words when there is room and below them when there isn't, and draws it over anything that is
  there.
- **Hiding the iOS menu isn't possible.** No supported web API hides or moves the menu on selected
  text while keeping normal selection and scrolling, so both menus stay. Copy is already in our box
  as *Copy, don't highlight*.
- **What changed.** The button now docks at whichever screen edge has more room between it and the
  words: at the bottom above the bar, or at the top under the top bar. Across the screen it still
  lines up with the words. The iOS menu stays beside the words, so the two no longer meet unless a
  selection fills the whole screen.
- **Not reproduced on a real iPhone.** Playwright draws no iOS menu, so the overlap itself could not
  be shown here. Placement and the press were checked in WebKit with iPhone, iPad and 320px
  profiles. **Greg, once it is deployed, please select some words near the top and near the bottom
  of the screen and say whether the two menus still collide.**
