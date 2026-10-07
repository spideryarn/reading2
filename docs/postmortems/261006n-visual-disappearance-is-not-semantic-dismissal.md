# Visual disappearance is not semantic dismissal

Caught before deployment in the code review of
[261006i](../plans/261006i-marginalia-narrow-notice-fades-and-can-be-dismissed.md), introduced by
`72121e004`. No reader encountered it. A screen-reader user could activate the button named
“Dismiss”; the button disappeared, but the Marginalia landmark and sentence remained in the
accessibility tree indefinitely.

## Two causes with one visual result were collapsed into one state

The automatic clock and the explicit button both set `gone`. Visually they should have the same
result, but semantically they should not: timeout preserves the unannounced explanation for a slow
screen-reader traversal, while an explicit Dismiss must remove what the reader dismissed. The root
cause was **using shared presentation state as the complete semantic state**. An independent review
subagent confirmed that the CSS deliberately hid only the button, so the control's accessible name
and result disagreed.

## Why the checks agreed

The timeout test asserted that the sentence remained in `textContent` and that the CSS used opacity,
which was right for automatic expiry. The button test asserted only the same `is-gone` class. No
test compared the two triggers' accessibility-tree outcomes, so the shared bit looked like reuse
rather than lost meaning. The new explicit-dismissal assertion was observed red with no
`aria-hidden`; the timeout assertion separately pins that it must not gain one.

## What would have caught it, ranked by ease against value

1. **Test each cause against its semantic outcome, not only their shared appearance.** Done: timeout
   keeps the explanation exposed; Dismiss adds `aria-hidden`.
2. **Keep the cause that changes semantics as monotonic state.** Done: `dismissed` is separate from
   visual `gone`, so a later timer callback cannot expose an explicitly dismissed line again. The
   button is blurred before its subtree is hidden.
3. **Unmount on either path.** Rejected. It would remove the timed-out explanation from assistive
   technology and make the small-screen banner appear in flow because the layout deliberately uses
   `:has(.marg-narrow)`.
4. **Build a generic dismissible-notice state machine.** Rejected as disproportionate for one
   notice. The two booleans are local, monotonic, and their different contracts are now tested.

The narrow review fix is the long-term design: retain the DOM node required by layout, preserve it
semantically after automatic fading, and hide it semantically only after explicit dismissal.

Up: [Postmortems](../project/postmortems.md)
