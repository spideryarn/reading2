# `position: sticky` fails silently when its containing block is too small

Not project-specific. This is a general CSS trap, written up because it cost real time and because
the failure produces **no error, no warning, and a plausible-looking page**.

A second, unrelated way sticky fails just as silently — cancelling one axis and losing both — is at
[the end](#a-second-silent-failure-cancelling-position-cancels-both-axes). If a third one ever turns
up, rename this file; two is not yet a collection.

## The rule

A sticky element is confined to its **containing block**. It slides within that box as you scroll
and stops at its edges — it can never be pushed outside it. So the amount of stick you get is:

```
sticky range  =  containing block size  −  element size
```

When that difference is **zero, the element has nowhere to slide and simply scrolls away with the
document**, exactly as if `position: sticky` had never been written. `getComputedStyle` still
reports `position: sticky`. The declaration is correct. Nothing anywhere says it isn't working.

Note that the containing block is the element's *parent box*, not the scrolling viewport, and not
whatever element grew a scrollbar. That's the whole trap: people reason about sticky in terms of
the scroll container, and it is actually governed by the ancestor box.

## What it looks like when it bites

A page whose content is wider than the viewport, with a toolbar meant to stay put as you scroll
sideways:

```css
.controls { position: sticky; top: 0; left: 0; width: 100vw; }
```

`top: 0` works. `left: 0` does nothing at all — because `.controls` sits in a `body` that is also
the viewport width, so a `100vw` element in a `100vw` box has a horizontal range of exactly zero.
The bar scrolls off to the left and leaves bare page showing through on the right, with content
drawn over the strip where the toolbar should be.

The same stylesheet had sticky table columns that worked perfectly, with a materially identical
declaration:

```css
td.pin-left { position: sticky; left: 0; }
```

Those work because a table cell's containing block is the **table**, which was wider than the
viewport — so there was real range to slide through. Identical declaration, opposite outcome, and
the only difference is an ancestor's width. That's why reading the CSS doesn't find this.

## Diagnosing it in one call

Don't inspect `position`; it will look right. Compare the element's rect to the viewport:

```js
el.getBoundingClientRect()   // [-97, 903] in a 1000px viewport → not pinned, whatever CSS says
```

A pinned element's rect stays put while you scroll. A negative `left` on something that claims
`left: 0` is the whole diagnosis. To confirm the cause rather than the symptom, compare the
element's width against its offsetParent's — equal widths mean zero range.

## Fixing it

Make the containing block as wide as the *content*, not as the viewport:

```css
.wrapper { width: max-content; min-width: 100%; }
```

Now the wrapper spans the full scroll width, the `100vw` bar has real range inside it, and
`left: 0` pins as intended.

**Verify rather than reason about it.** Changing a containing block is exactly the kind of edit
that disturbs *other* sticky descendants — and their failure mode is this same silent one, so a
stack of sticky layers can quietly stop sticking without anything visibly breaking. If you have a
sticky stack, check every layer after the change, not just the one you were fixing.

## A second silent failure: cancelling `position` cancels *both* axes

Different cause, same character — the CSS reads correctly, nothing errors, and the page looks right
in a screenshot.

**A sticky element sticks on two independent axes.** `top`/`bottom` and `left`/`right` are separate
anchors sharing one `position: sticky`. The trap is that the obvious way to stop something sticking
sideways is to stop it being sticky:

```css
/* Below 760px there is nothing to scroll horizontally, so unpin the column. */
@media (max-width: 760px) {
  .pin-left { position: static; }   /* ← also cancels the vertical stick */
}
```

`position: static` is not "unset the horizontal anchor", it is "stop being sticky". Both axes go. In
the case that produced this note, one of the elements involved was a **table column header**, so the
table head quietly stopped pinning under the toolbar — on exactly the narrow screens where losing it
hurts most, and only there, because the rule was in a `max-width` query.

The fix is to cancel the anchor, not the positioning:

```css
@media (max-width: 760px) {
  .pin-left { left: auto; }   /* no horizontal anchor; keeps its `top` */
}
```

`auto` on one inset leaves the element sticky and simply gives that axis nothing to stick to.

**Why it survives review.** It is invisible at the top of the page — where every screenshot is taken
— because a header that has not yet been scrolled past looks identical whether or not it is pinned.
It only exists once you are far enough down for the pin to matter. The reading that found it was
taken 4000px down the page:

```js
document.querySelector('thead').getBoundingClientRect().top   // -3759, not 0
```

A pinned header's rect `top` stays at its offset forever. Any large negative number means it left
with the document. So: **scroll first, then measure** — the same discipline the containing-block case
needs, and for the same reason.

## The general shape

Any time sticky "doesn't work" and the CSS looks right, the question is not *what is scrolling* but
**what box is this element in, and is it bigger than the element**. The same reasoning covers the
better-known version of this bug — a sticky element inside a short parent unsticks early, as soon
as the parent's bottom edge scrolls past — which is the same arithmetic with a smaller-than-expected
range instead of a zero one.

Seen in the wild: [spideryarn browser-testing.md](../project/browser-testing.md), where it hid
behind a two-axis scrolling table for as long as nobody scrolled sideways.
