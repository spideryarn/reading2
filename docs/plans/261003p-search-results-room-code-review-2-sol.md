No findings.

The stated contract matches the code:

- Only controlled tooltips suppress `reason === "hover"` closes while `byTouch` remains set.
- Escape, outside press, focus dismissal, safe-polygon dismissal, and direct parent state changes are unaffected.
- Uncontrolled tooltips never enter the suppression branch.
- Real mouse entry/exit on the trigger, mouse entry into the card, pointer cancellation, or closing the card clears the exemption.
- Floating UI’s prop getter invokes its handler once and the supplied wrapper once; the wrapper invokes the child’s original handler once. None are dropped or duplicated.
- The `open` effect cannot clear the flag between pointerdown and click merely because the card is still closed: mutating the ref does not rerun the effect, and the click’s `open=true` render takes the non-clearing branch.

Requested tests passed: 2 files, 35 tests.

Files changed: none.

VERDICT: land