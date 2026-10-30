---
reports: spya-k3g78t
ending: awaiting
comment: Probably the iPad still busy restyling the page as the dialog opens. Making Feedback non-modal, so the page is never frozen, removes that; whether the article behind stays usable is your call: question q-f7xm4h.
---
# Scrolling inside the Feedback dialog sometimes scrolled the article

`spya-k3g78t` (#735, problem, [SPIDERYARN-READING2-Q6](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-Q6)), from Greg (admin; `feedback-reporter.ts` exit 0 on the production
row). Filed 2026-10-29 08:59 UTC from
`/read/arxiv-2308-08708-spya-xax6v4?at=spya-e8jmnr&margin=1`, build 8352c47a, a minute before
[`spya-bewb4q`](261029_0901-feedback-send-slow-on-an-ipad-was-the-page-not-the-button.md) from the
same iPad. No screenshot, no diagnostics. Addenda: none.

> The feedback mode dialog works okay, but not brilliantly. So, for example, sometimes when the
> feedback mode dialog is open and I try and scroll within the dialog box, it actually scrolls the
> text in the article behind, even though the dialog box is supposed to be modal. It's not the end
> of the world. If I wait and then try again, it usually works. It just feels a bit janky somehow. I
> wonder if, I don't know, are we making use of the right abstractions or third-party library
> framework stuff for dialog boxes, or I don't know, is there just a better way to implement it or
> make it more robust?

**Ending: awaiting** Greg, on question `q-f7xm4h` (queue item `qi-qs3q794t`). Plan:
[261029k](../plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md).

## What we found

- **Not reproduced in Chrome**, by mouse wheel or touch, in five places in the dialog, on a short
  window and a tall one: the article never moved. The dialog's scroll lock holds there.
- **Opening the dialog costs the whole article.** A modal dialog makes the rest of the page inert,
  and browsers do that by restyling every element: 13–19 s to open on a book in Chrome slowed six
  times, to stand in for an old iPad
  ([261029a](../investigations/261029a-feedback-dialog-cost-on-a-long-article-measured-at-six-times-throttle.md)).
- **The likeliest explanation** (a hypothesis; it needs your iPad to test): an iPad scrolls using the
  last version of the page that was ready, separately from the page's own code. While the page is
  still being restyled, that version does not yet have the dialog's scroller in it, so the swipe
  goes to the article. That fits *"if I wait and then try again, it usually works"*.

## Your question, answered plainly

The browser's own `<dialog>` is the standard, recommended tool, and it is not the wrong abstraction.
It gives a focus trap, Escape and an inert background for free. Its one weakness is the cost of that
inert background, which is nothing on a short page and seconds on a book on an old iPad. A library
would not have saved us: Radix, where our other components come from, avoids "inert" but sets
`pointer-events: none` on the whole page, which is again work on every element, and its scrollbar
handling fights a setting we use to stop the layout jumping. **The sturdier way is a small dialog of
our own that leaves the page alone**, and that is the question
([postmortem 261029d](../postmortems/261029d-a-modal-dialog-inerts-every-element-so-opening-and-closing-cost-the-whole-article.md)).

## What we did meanwhile

The same work as `spya-bewb4q`: typing in the dialog no longer makes the browser search the whole
article after each key, and the hidden Earlier tab is not redrawn while you type. Both mean shorter
stalls while the dialog is open, so fewer moments for a swipe to go astray, but opening is still
slow, so this is not claimed as a fix.
