# An absence assertion needs to outlast the effect it forbids

Review of sweep stage B found a test that could report a missing tooltip while its open timer was
still pending. No reader behaviour changed. The old real wait became a fake advance in
`4e6184fde`, but its literal 400 ms survived; the original literal was introduced by `2e99483c8`.

The control changed `Tooltip`'s exported `DELAY.open` to 1000 and wrapped `CriteriaPanel`'s
`.crit-rank` in a real `Tooltip`. The converted `has no hover-only card on the numeral` case still
passed. Its query really ran, but only before the forbidden card had time to open.

## The class: absence asserted before an effect can happen

Positive assertions fail when the clock advances too little. Negative assertions instead agree
with the bug: a pending effect and an absent effect look the same. Replacing a sleep with fake
timers removes wall-clock cost without repairing that distinction.

The fix uses `DELAY.open` in this ungrouped negative assertion. With the same two mutations still
applied, it failed with `the hover-only duplicate of the visible line is back`, expected length 0,
received 1. Both mutations were then removed; the complete criteria and send-key files passed
(32 tests). The send-key file was a separate control: disabling `useFocus` made its keyboard card
assertion fail, so its mouse-to-keyboard sequence was not reading a leftover hover card.

## Countermeasures ranked by ease against value

1. **Advance by the effect's owned delay.** Done here; a group supplies its own delay, so the base
   tooltip constant is only the source for an ungrouped card.
2. **Mutation-check negative assertions with the forbidden effect present.** Cheap at a conversion
   boundary, and distinguishes absence from unfinished work.
3. **Run every pending timer before every assertion.** Rejected: that runs unrelated work, can
   consume an intended observation window, and cannot replace the separate renders needed by a
   close transition.

The long-term fix is to make each negative assertion cover the window in which its forbidden
effect can occur, using the same owner of that window as the component. Fake timers alone do not
establish that coverage.

Up: [Postmortems](../project/postmortems.md)
