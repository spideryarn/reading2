# A modal dialog inerts every element, so opening and closing cost the whole article

Found from `spya-k3g78t` and `spya-bewb4q` (Greg, 2026-10-29, an old iPad: scrolling inside the
Feedback dialog sometimes scrolls the article; after *Sending* it takes a while to close), and
measured in
[261029a](../investigations/261029a-feedback-dialog-cost-on-a-long-article-measured-at-six-times-throttle.md).
The fix is a decision, asked as `q-f7xm4h`
([261029k § Stage 2](../plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md#stage-2-a-modal-that-inerts-nothing-gregs-decision-not-built)).

## What happened

On an 87k-node book at 6× CPU throttle, `showModal()` took 13–19 s and `close()` 13–15 s. Setting
the `inert` attribute on the article alone, with no dialog, cost the same; calling `show()` (not
modal) instead cost 0.8 s to open and nothing to close. On an iPad the scroll leak fits the same
stall: scrolling runs off the main thread against the last layer tree the page committed, and during
a multi-second restyle that tree does not yet hold the dialog's scroller.

## The root cause

`showModal()` makes everything outside the dialog inert, and Blink and WebKit both represent
inertness as part of each element's computed style. So opening and closing a modal is a restyle of
every element in the document, and on this app that is the article. The cost per element is high
here too (≈4,300 rules, 62 of which every element must be tested against), which multiplies it, but
removing those 62 only halved it.

The decision to use `showModal()` was sound and was argued for in the code: focus trap, Escape, the
top layer and an inert background for free, where the three hand-rolled non-modal panels each
re-implement part of that. **What nobody priced was the inert background**, because the platform
presents it as free and on a short page it is.

## The class

**A platform feature that is O(document), adopted as if it were O(component).** Any switch that
changes a computed-style property for every element — `inert`, `pointer-events: none` on `body`
(what Radix's dialog does), a theme attribute on `<html>` with rules that recompute everything —
costs the article, not the control that flipped it.

## Introduced

Lightbox.tsx's `showModal()` in `9db98ffb0` (2026-08-28), the precedent; FeedbackDialog.tsx followed
in `54ec2d2c3` (2026-09-01). Seven callers now.

## The right long-term fix

A modal surface that changes nothing outside itself: a full-screen overlay (which already takes every
pointer), `aria-modal="true"`, our own focus trap and Escape, and a touch/wheel guard so only the
dialog's scrollers move. Its cost is the dialog's size, not the article's. It gives up the platform's
focus handling and a real inert background for screen readers, which is why it is a question rather
than a fix (`q-f7xm4h`). Until it is answered the cost stands, and both reports' notes say so.

## What would have caught the class, ranked by ease against value

1. **Name the cost where the choice is made**: the comment in FeedbackDialog.tsx and Lightbox.tsx
   that lists what `showModal()` brings for free now says what it costs, so the next caller weighs
   it. Being done.
2. **Measure open and close on the longest article on a throttled CPU** before adopting a platform
   primitive on the reading view. The same habit as
   [261029c](261029c-a-has-selector-anchored-above-the-article-walks-the-whole-document-on-every-change.md)'s
   item 3; one harness serves both.
3. Shrink the per-element restyle (the 62 rules every element is tested against). Halves the cost of
   every full restyle, so worth doing on its own, but the cost stays proportional to the article.
   A queue item, not the fix.
