1. **F1 — P1, established: Escape loses keyboard focus.**  
   The plan’s `returnFocus={false}` disables restoration when the focused Help link disappears ([plan:64](/home/greg/code/spideryarn2/.claude/worktrees/tooltip-interactive-prop/docs/plans/261002e-interactive-tooltip-prop-and-help-link-in-band-about-cards.md:64)). Floating UI explicitly checks that flag before restoring focus (`node_modules/@floating-ui/react/dist/floating-ui.react.esm.js:2080`). A throwaway jsdom implementation of the proposal confirmed: focus link → Escape → card unmounts → `document.activeElement === document.body`.

   **Fix:** return focus to the trigger when Escape dismisses a card containing focus. Keep `initialFocus={-1}`: it correctly prevents focus moving on hover (`…esm.js:2008`). Avoid unconditional restoration that could move unrelated focus when a hovered card closes.

2. **F2 — P1, established: mouse dismissal can remove the focused link.**  
   `safePolygon` protects pointer travel; it does not protect keyboard focus. Its `onClose` reaches `onOpenChange(false)` without checking whether focus remains inside (`…esm.js:834`, `…esm.js:4584`). `FloatingFocusManager` does not veto that closure. A probe confirmed: hover → focus link → move through the card and away → card closes and focus falls to `<body>`.

   **Fix:** for interactive cards, ignore closures whose reason is `hover` or `safe-polygon` while focus remains within the trigger or card. Let focus-out, Escape and outside press dismiss normally. Add a regression test for this mixed mouse/keyboard sequence.

3. **F3 — P1, established: use `dialog`, with an accessible name.**  
   Keeping `tooltip` for focusable content contradicts the intended interaction ([plan:73](/home/greg/code/spideryarn2/.claude/worktrees/tooltip-interactive-prop/docs/plans/261002e-interactive-tooltip-prop-and-help-link-in-band-about-cards.md:73)). W3C’s [tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) directs hovers containing focusable elements toward a non-modal dialog.

   **Fix:** use `role: interactive ? "dialog" : "tooltip"` and name the dialog, for example “About this mode”. Floating UI supplies `aria-haspopup="dialog"`, `aria-controls` and `aria-expanded` for that role (`…esm.js:3845`). The trigger’s existing `aria-expanded` is compatible, but neither names the dialog nor makes tooltip semantics appropriate. If spoken descriptive text is needed, separately reference the explanatory paragraphs with `aria-describedby`; a dialog and a description can coexist.

4. **F4 — P2, reasoned touch risk: controlled state does not record a click opening.**  
   `BandAbout` toggles React state directly ([BandAbout.tsx:34](/home/greg/code/spideryarn2/.claude/worktrees/tooltip-interactive-prop/src/web/BandAbout.tsx:34), baseline). This bypasses Floating UI’s recording of `dataRef.current.openEvent` (`…esm.js:2876`). Hover’s protection for click-open cards depends on precisely that metadata (`…esm.js:789`, `…esm.js:816`). Also, `mouseOnly` gates mouse **entry**, not the mouseleave handlers (`…esm.js:801`, `…esm.js:815`).

   An ordinary tap inside the card is correctly excluded from outside-press dismissal (`…esm.js:2727`), and moving focus into its link is allowed (`…esm.js:3127`). However, “nothing else to do” overstates the touch guarantee: a probe with touch opening followed by compatibility mouse events closed the card. Whether the intended tap-link sequence produces that failure still needs browser evidence.

   **Fix:** use Floating UI’s `useClick` for an explicitly opted-in BandAbout trigger, removing its duplicate manual toggle. Its default `stickIfOpen` also lets a click pin a hover-open card (`…esm.js:2332`). Keep that change out of the spine. Test first tap, second tap to close, and tap-link with touch emulation and event logging.

5. **F5 — P2: the proposed tests can pass without proving the interaction.**  
   The proposed `mouseleave → mouseenter(card)` test ([plan:114](/home/greg/code/spideryarn2/.claude/worktrees/tooltip-interactive-prop/docs/plans/261002e-interactive-tooltip-prop-and-help-link-in-band-about-cards.md:114)) cancels the close timer even with `handleClose: null`: `onFloatingMouseEnter` always clears it (`…esm.js:879`). jsdom also dispatches events onto elements regardless of CSS pointer hit-testing. Calling `link.focus()` proves focus retention, not Tab reachability.

   **Fix:** exercise the outside and inside focus guards in jsdom; assert the resulting active element and eventual dismissal. Test mouse travel with document mousemove events and explicit rectangles, then verify actual hit-testing and gap geometry in the browser. Add assertions for Escape returning focus, hover never changing focus, and mouse departure preserving focused content. Flush close-delay and transition timers across separate renders. Mutation-check that removing the corridor or focus manager fails the corresponding assertion.

6. **F6 — P3: the default path can remain unchanged; preserve that boundary explicitly.**  
   The proposed conditional class, `handleClose: null` fallback and absence of a focus manager preserve the existing spine path ([plan:79](/home/greg/code/spideryarn2/.claude/worktrees/tooltip-interactive-prop/docs/plans/261002e-interactive-tooltip-prop-and-help-link-in-band-about-cards.md:79); [tooltip.css:25](/home/greg/code/spideryarn2/.claude/worktrees/tooltip-interactive-prop/src/web/styles/tooltip.css:25)). Make the role change and any click/focus protections conditional too.

   **Fix:** add preservation checks for a **controlled, grouped** non-interactive tooltip, matching the spine rather than only a standalone uncontrolled fixture. The Help wiring through `helpHref(modeAnchor(mode))` is sound. Reusing Floating UI plus the existing CSS is already the simplest reliable approach; a close-delay-only alternative is smaller but does not provide equivalent slow-pointer travel. When resolving Q10, state that ordinary non-interactive cards retain their existing hoverability limitation.

**Verdict: request changes—retain the opt-in design, but fix focus loss and dialog semantics before building it.**