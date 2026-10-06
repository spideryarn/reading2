# Input and focus ownership inferred from shared UI state

Two regressions were reproduced while reviewing Skim's glossary cards in commit `0432a7404`.
This review made no deployment. Both fixes are confined to
[`SkimPanel.tsx`](../../src/web/SkimPanel.tsx); the prose card and shared Tooltip are unchanged.

## The classes

**Input modality inferred from presentation state.** `TermChip`'s `held` state meant either hover
or focus, but its click handler treated `held` as proof of a mouse click. A touch or pen activation
could focus the chip before click, so neither the opening tap nor the second tap changed the pin.
The card remained open on focus alone. The fix records the activating pointer's type, clears that
record on cancellation or keyboard input, and lets touch/pen toggle the pin while clearing `held`.

**Focus ownership inferred from a shared container.** A successful Hide rescued focus anywhere in
`.skim-card` or `.skim-term-tip`. If the reader focused another term while the request was pending,
the old Hide moved them back to the row and closed their new card. The fix captures the focused
element when Hide starts and restores focus only if that element still owns it, or if its removal
left focus on the body. Another term in the same container does not qualify.

Both mistakes were introduced by `0432a7404`, which added `TermChip` and `focusCurrentRow`.
An independent subagent confirmed the causes during this review.

## Why the previous tests agreed

The tap test used `.click()` without pointerdown or focus, bypassing the event order that broke
pinning. The Hide test immediately removed the final term and never moved focus while awaiting
the write. Neither test challenged the ownership inference its corresponding implementation made.

In [`skim-panel.test.tsx`](../../tests/skim-panel.test.tsx), the new touch regression failed with
`aria-expanded` still `true` after the second tap. The deferred Hide regression expected focus on
the next term and received the stop's `.skim-go` button. Both were seen red before either fix,
then green. The suite also covers pen activation and Tab into the card, Escape back to the chip,
and keyboard reopening.

## Countermeasures, ranked by effort against value

1. **Tests that include the input sequence and an intervening user action.** Added here: explicit
   pointerdown/focus/click and a deferred write with focus moved before completion. Cheap, and they
   challenge the inferred ownership rather than merely exercising the happy path.
2. **Capture the actual owner at the boundary.** Implemented here: pointer type at activation and
   focused element at request start. Presentation flags and broad ancestor selectors are weaker
   evidence than those identities.
3. **A universal focus/input state machine.** Rejected: these two local decisions need only a
   pointer ref and a captured element. A second shared interaction framework would add more
   coordination than it removes.

These are the long-term fixes as well as the review fixes; neither needs a change to the shared
Tooltip or the glossary's own card.

Up: [Postmortems](../project/postmortems.md)
