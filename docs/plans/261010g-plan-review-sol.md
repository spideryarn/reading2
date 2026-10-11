Review verdict: build with changes. One functional selection bug needs fixing before implementation is accepted.

1. **High — generated suggestions will leave “Guide chat” selected instead of the first suggestion.**  
   `suggest()` resets selection to index `0`, and `previousReasonRows` deliberately does nothing when a new list arrives. Once Guide chat owns index 0, the next Enter opens it rather than the first newly generated suggestion. Fix the new-list branch to select the first row whose `suggested` field is present, by row identity rather than a fixed index. Add an `openGuide` variant of the existing suggestion-list test that checks the first suggestion is selected and activated. See [CommandBar.tsx](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/src/web/CommandBar.tsx:2024) and [CommandBar.tsx](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/src/web/CommandBar.tsx:2428).

2. **High — the renamed command-pick catalogue must be regenerated.**  
   Changing the label, description, and aliases changes the server-side catalogue entry. Add this explicitly to the plan:
   `WRITE_COMMAND_PICK_CATALOGUE=1 npx vitest run tests/command-pick-catalogue.test.ts`.
   The targeted run currently has 117 passing tests and exactly this catalogue check failing. See [command-pick-catalogue.test.ts](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/tests/command-pick-catalogue.test.ts:14).

3. **Medium — the guide separator must be a separate boundary from `firstOrdinary`.**  
   The existing rule only appears when the preceding row is a generated suggestion. A pinned guide is not one, so merely recalculating `firstOrdinary` is insufficient. Extract the guide from `results`, render it once, and explicitly draw a separator immediately before row 1; retain the independent suggestions-to-ordinary separator. Test the separator’s exact sibling position, not merely that some `.cmdbar-rest` exists, because a later suggestion boundary could satisfy that assertion falsely.

4. **Medium — an existing ordering contract becomes false without failing.**  
   [command-bar.test.tsx](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/tests/command-bar.test.tsx:332) says every non-mode follows every mode, but its fixture does not provide `openGuide`, so it stays green while production gains a leading action row. Rewrite the contract as “the pinned Guide chat is the sole exception; among the remaining rows, all modes precede non-modes,” and exercise the owner configuration with `openGuide`.

5. **Medium — the argument collision matrix does not currently contain the guide command.**  
   Its “every row” fixture omits `executor.openGuide`, so the new label and aliases are never checked. Add `openGuide: close` and assert that `Guide chat`, `guide`, `chat with the guide`, and `help me read` are present in the matrix. By inspection, none currently collides with an argument verb; this is a coverage hole, not a discovered collision. See [command-match-arguments.test.ts](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/tests/command-match-arguments.test.ts:174).

6. **Low — add the Chat-header Compass to the plan’s test checklist.**  
   The plan identifies every visual naming site correctly: the two command rows, Chat’s pinned guide row, the greeting, and the open-guide header. Help’s “guides” are prose/category names and should not gain Compasses. Add an assertion in [guide-in-chat-panel.test.tsx](/var/tmp/spideryarn-worktrees/fbq3pzyn-guide-in-command-bar/tests/guide-in-chat-panel.test.tsx:235) that the guide header contains a decorative Compass; the concurrent work-in-progress already added the right assertion.

The product decisions themselves look right: making the free, no-send guide row the bare-Enter default is safer than defaulting to a paid Suggest request, and “Guide chat” clearly distinguishes the conversation from Help’s reader guides. Keep `besideTheModes` in its existing order and do the pinning only in the presentation-level `shown` construction; that is the simplest implementation and preserves typed ranking and pick behaviour.