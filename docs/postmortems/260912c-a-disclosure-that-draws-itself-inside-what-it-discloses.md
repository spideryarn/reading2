# A disclosure that draws itself inside what it discloses

**SPIDERYARN-READING2-38**, Greg on an iPad, 2026-09-12:

> The only issue I notice is when I click on the three dots, it actually includes three dots within
> the menu that expands out, and I don't think that's right. It's like three dots, click on that, and
> then it has yet more three dots, but I don't know what that does. I don't think it does anything.

## What happened

On a short paragraph the gutter has no room for all of its controls, so the last slot that fits
becomes a "…" and pressing it unfolds the column. The unfolded column ended in a second "…". It was
the same button: the rule that unfolds the column is

```css
.blk-gutter[data-open] > * { display: inline-flex; opacity: 1; pointer-events: auto; }
```

— *every* child, and the disclosure is a child. It did do something: it toggled the panel shut. But
it said so only in a `title` ("Fewer"), which never shows on a finger, under a glyph that says
*more*; and on an iPad a press anywhere else closed the panel too, so the one thing it did was the
thing every other part of the screen already did.

## Root cause, and the class

**Introduced by `a8215986`** (*The gutter draws what the row has room for, and a "..." for the rest*,
2026-09-05), which wrote the open rule as `> *` because what it wanted was "show everything that was
folded away" — and the disclosure was never folded away, it was the thing doing the folding. The
glyph was never changed for the open state because the column had been designed as "these same
controls, unfolded", and the button that unfolds them was not thought of as one of them.

**The class: a universal selector over a container that includes its own control.** "Show everything
in here" is a statement about the *contents*, and `> *` quietly includes the element that operates
the container — so the operator appears among what it operates, in a state its label was not written
for. It is the same shape as a "select all" that selects its own checkbox, or a "collapse all"
listed among the things it collapses.

## The fix that is right for the long term

Not hiding the button (`display: none` on it while open) — that was stage 1 of
[260912c](../plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md), and GPT Sol's plan
review moved it on: hiding the disclosure takes it and its `aria-expanded` out of the accessibility
tree and leaves the focus to the browser's fix-up on Safari. The fix is **a control that says what a
press does in each state**: while open it is an ✕ named "Close paragraph controls", and the element,
its focus and its expanded state stay where they are. The universal rule is left as it is, because
the disclosure really does belong in the open column — as the way out.

## What would have caught it

- **Naming the controls' states when the disclosure was built.** The component comment described the
  "…" in one state only. A disclosure has two, and each needs a glyph and a name that are true in it.
- **A look at the open state on a finger.** The desktop checks had a tooltip that said "Fewer"; no
  check looked at the open column on a device where a tooltip does not exist. The 260912c browser
  pass now covers the open column at iPad width, and `tests/block-gutter.test.tsx` § the "…" pins the
  ✕ and its name in the open state.
