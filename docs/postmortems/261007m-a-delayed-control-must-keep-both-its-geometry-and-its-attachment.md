# A delayed control must keep both its geometry and its attachment

Two defects found in the F2 review, before shipping, both introduced by
`40ea6ea43`. [Review and evidence](../plans/261007h-f2-code-review-sol.md).

The classes are **an invisible placeholder with different layout rules from its
visible replacement**, and **a ref attachment mistaken for a selection change**.
Both treat a later render as though it only changed words or options, when it
also changes the box or attaches a new element.

The wait-line ghost put `flex: none` on both its spinner and sentence. The real
sentence could shrink and wrap, but its placeholder could not. The reserved
footprint therefore need not be the eventual footprint. Restricting the fixed
flex sizing to the SVG lets both sentences use the same wrapping rules.

Skim mounted `RouteHead` with one offered depth, so its conditional fieldset did
not exist when `useRevealChosen` first ran. A route refresh can add depths while
remaining ready and keeping the same chosen depth. The stable ref object and
choice then do not rerun the effect: the new fieldset gets neither its initial
reveal nor resize/font/child observers. Making fieldset presence part of the
trigger fixes this caller without changing OrderGroup's shared lifecycle.

These are the long-term fixes for the current shapes. If more callers acquire
conditional bars, element attachment should become an explicit shared hook
input rather than relying on each caller to encode presence in its trigger.
That broader API change is not needed for this fix.

Countermeasures, ranked by ease against value:

1. **Test the transition that retains the choice while attaching the box.**
   Added to `tests/skim-panel.test.tsx`: a ready one-depth route becomes a
   three-depth route with Most still chosen. It failed at scrollLeft 0 instead
   of 130 before the fix and passed afterwards.
2. **Compare placeholder and replacement flex behavior.** Added to
   `tests/band-waiting.test.tsx` using the actual wait CSS: the hidden span's
   flex-shrink was 0 against the visible span's default 1. Seen red, then green.
   This checks sizing, not pixel heights.
3. **Measure the same narrow box before and after the delay in a browser.**
   `tests/band-waiting-layout.test.tsx` already exercises eleven callers at
   280 and 360px. Chrome was attempted here but died at launch with
   `setsockopt: Operation not permitted`, before any geometry assertion.
   This remains the stronger check on the resulting height.
4. **Rejected: replace every ref hook with a callback-ref abstraction.** It
   adds lifecycle machinery to unconditional bars that already work. A local
   presence trigger addresses the established conditional caller; broaden only
   when there is another demonstrated need.
