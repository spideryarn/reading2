# A focus boundary must grow when a control gains a second focusable child

Owned by [postmortems.md](../project/postmortems.md).

Review of the [quick-search clear cross](../plans/261004g-quick-search-box-clear-cross.md)
found that moving keyboard focus from the input to its new button hid both of them while Search
mode was open. This was caught in review of a committed stage; production impact was not established.

## The class: a compound control still using its first child's focus boundary

Commit `cdb7642e8` added a focusable clear button to `DockQuickSearch` while retaining the input's
`onFocus`/`onBlur` as the definition of whether the field had focus. That definition was correct
when the input was its only focusable child. It became wrong when Tab could move to the cross:
input blur set `focused` false, `searching && !focused` added `dock-qs--bolt`, and the stylesheet hid
the field containing the newly focused button. The band's blur timer also began ending the typing
session despite the reader still being inside the search control.

The new mouse path deliberately prevented `mousedown`'s default focus transfer. This protected the
mouse path and helped conceal the missing boundary on other paths. The shelf's clear cross is a
nearby sibling, but its field is not hidden when its input blurs; it does not have this failure.

## Why the existing checks stayed green

The committed component suite passed all 34 tests. Its new press helper dispatched a synthetic
`mousedown`, then called `click()`; it never transferred focus to the button. Removing both clearing
calls (`draft.set("")` and `draft.band()?.edit("")`) made three clear-cross tests fail, establishing
that those tests detect missing clearing. They did not establish that keyboard users could reach it.

The added regression moved actual DOM focus from the input to the cross after the Search band opened.
On the candidate, its expectation that `dock-qs--bolt` remained absent failed: expected `false`, got
`true`. This exercises the missing transition independently of the synthetic press helper.

## The fix that is right for the long term

The review fix moves focus handling to the enclosing field and ignores blur when `relatedTarget`
remains inside it. Leaving through either child still releases focus and starts the band's normal
blur rule. Clearing restores focus to the input. The responsive visibility check also treats any
focused descendant as belonging to the field, so hiding it hands the reader to the panel even when
the cross has focus. The fix and the long-term boundary are the same; extra pointer-specific focus
suppression is not needed to define the compound control correctly.

## What would have caught the class, ranked by ease against value

1. **Transfer DOM focus between children, then out of the control** — implemented in this review.
   Small regression tests cover staying visible, keeping the typing session while inside, clearing
   by button activation, leaving through the button, and responsive hiding with the button focused.
2. **Review the focus boundary whenever a focusable child is added** — cheap: identify which state
   controls visibility or session lifetime, then exercise both internal and external focus changes.
   A press helper only proves the activation path it actually drives.
3. **A new accessibility automation system** — rejected for this small stage. It costs more than
   the boundary tests and would still need this exact state and transition to detect the defect.

A real browser check remains unverified here: the review sandbox refused Vite's loopback listen
(`EPERM`) and system Chrome's crashpad socket (`setsockopt: Operation not permitted`, `SIGTRAP`).
The DOM regression is evidence of the focus-state defect; it is not a completed touch, pen or CSS
layout check.
