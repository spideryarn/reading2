Verdict: **changes needed**

1. **The diagnosis is plausible but claims more certainty than the evidence supports.**  
   [plan:31](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/docs/plans/261019b-ipad-selection-chip-sits-near-the-words-and-a-finger-is-known-from-touchstart.md:31), [TouchSelectionChip.tsx:190](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/src/web/TouchSelectionChip.tsx:190), [TouchSelectionChip.tsx:248](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/src/web/TouchSelectionChip.tsx:248)

   “Only two candidates survive” is too strong. The far-away chip is a genuine discoverability defect, but does not prove why it was absent. Real-iPad-only candidates remain: repeated `selectionchange` events continually restarting the 300ms timer, real-device `scroll`/`resize` events hiding it, or the native selection not passing `readSelectionWithRange`. The cited WebKit precedent also mislabels the later `click`; its `pointerdown` was specifically correct, so it is not evidence that this `pointerdown` was wrong.

   **Concrete fix:** say these are “the two cheap, plausible defects worth removing,” not the only surviving causes. Keep event churn and selection-read failure as unresolved candidates, with event tracing as the next step if the real iPad still fails.

2. **Do not add unconditional `touchend`/`touchcancel` settling as proposed. It weakens input ownership and needs chip-press semantics the plan does not specify.**  
   [plan:87](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/docs/plans/261019b-ipad-selection-chip-sits-near-the-words-and-a-finger-is-known-from-touchstart.md:87), [TouchSelectionChip.tsx:229](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/src/web/TouchSelectionChip.tsx:229), [TouchSelectionChip.tsx:285](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/src/web/TouchSelectionChip.tsx:285), [tests:580](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/tests/touch-selection-chip.test.tsx:580)

   A live mouse-created selection followed by an unrelated `touchstart`/`touchend` would be scheduled as a touch selection. A `touchstart` handler that calls `hide()` would also clear `armedPress` and the grace period when the reader presses the chip itself, between its `pointerdown` and `pointerup`.

   Current iOS WebKit normally sends `pointerdown` before `touchstart`, but Pointer Events deliberately does not define its ordering relative to Touch Events. Pencil may also produce Touch Events; that is desirable here, but “a finger, and nothing else” is inaccurate. Mouse and Magic Keyboard trackpad input should remain `pointerType: "mouse"` without Touch Events. [Pointer Events specification](https://www.w3.org/TR/pointerevents4/), [Apple touch types](https://developer.apple.com/documentation/uikit/uitouch/touchtype).

   **Concrete fix:** take the simpler change: add passive `touchstart` only as corroborating evidence that sets `finger.current = true`; retain existing `pointerdown` as the owner of hiding/new-gesture state, and omit `touchend`/`touchcancel` scheduling. A document selection change is required to schedule `selectionchange`; the current pointer endings remain extra settling signals. [Selection API](https://www.w3.org/TR/selection-api/)

   Add a realistic test covering:

   - `pointerdown → touchstart → selectionchange`;
   - chip `pointerdown → touchstart → selection collapse/grace → pointerup`;
   - a mouse selection followed by unrelated touch events;
   - a new touch outside the chip still hiding it.

   If end-event fallback is retained, snapshot the selection at `touchstart` and schedule only when the ending selection differs; explicitly exempt the chip target and test `touchcancel`.

3. **The CSS algebra is correct, but the plan understates the cases where the floor wins.**  
   [plan:50](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/docs/plans/261019b-ipad-selection-chip-sits-near-the-words-and-a-finger-is-known-from-touchstart.md:50), [TouchSelectionChip.tsx:111](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/src/web/TouchSelectionChip.tsx:111), [annotations.css:1463](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/src/web/styles/annotations.css:1463), [tests:548](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/tests/touch-selection-chip.test.tsx:548)

   For the bottom edge, the proposed expression makes the chip’s top exactly `selectionBottom + clearance`; for the top edge it makes the chip’s bottom exactly `selectionTop − clearance`. The existing offsets correctly prevent it going under the top bar, app Dock, safe area, or install hint.

   When the chosen gap cannot hold `edge offset + chip height + clearance`, however, the floor wins. Then the chip can overlap selected words or the native menu. This includes tall selections that leave small gaps at both edges, not only a selection literally taller than the screen. A viewport-filling selection clamps to `top=0`, `bottom=innerHeight`, chooses bottom on the tie, gets `room=0`, and docks above the bottom chrome.

   **Concrete fix:** replace “screen-filling selection” with the exact insufficient-gap condition. Define the no-geometry return explicitly as `room: 0`, preserving jsdom’s docked-bottom behavior. Add tests for `room=0`, a tall selection with two small unequal gaps, no range geometry, and a short landscape viewport. No formula change is needed.

4. **`5rem` is a reasonable first measurement only at the usual 16px root; it is the wrong unit for native chrome.**  
   [plan:51](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/docs/plans/261019b-ipad-selection-chip-sits-near-the-words-and-a-finger-is-known-from-touchstart.md:51), [tests:566](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/tests/touch-selection-chip.test.tsx:566)

   At 16px, 5rem is 80px, plausibly enough for a roughly 44px menu, handle, pointer, and gap. But the native menu does not track the page’s root font size: at a supported 12px root this falls to 60px, leaving almost no margin over the plan’s own estimate.

   **Concrete fix:** use a named fixed clearance of `80px`—or `max(80px, 5rem)` if enlargement with browser font settings is wanted—and describe it as provisional until checked on the real iPad. Update the CSS-source test to assert the named clearance rather than embedding `5rem`.