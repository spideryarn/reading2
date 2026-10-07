**F1 — P1, established: the promised visitor path is unreachable.**  
The plan promises these rows to visitors ([plan:64](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/docs/plans/261005d-theme-commands-in-the-command-bar.md:64)), but the shortcut is disabled for visitors ([Dock.tsx:2004](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/src/web/Dock.tsx:2004)), and both the button and dialog return `null` ([Dock.tsx:3409](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/src/web/Dock.tsx:3409), [Dock.tsx:3541](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/src/web/Dock.tsx:3541)). Adding rows cannot change that. Narrow this plan to existing owner command bars; enabling visitors would require separately reviewing the other commands exposed through that door.

**F2 — P1, established: the changing description conflicts with the catalogue contract.**  
The current row gains a sentence without changing its label ([plan:50](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/docs/plans/261005d-theme-commands-in-the-command-bar.md:50)). `pickOption` copies that description ([command-match.ts:375](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/src/web/command-match.ts:375)), while the generator rejects different descriptions under one `(id, label)` ([catalogue test:203](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/tests/command-pick-catalogue.test.ts:203)).

Generating all appearance states triggers that collision. Generating only one state passes, but freezes “This is what you have now” into the server’s catalogue for every reader: the server receives keys and retrieves its stored description ([command-pick-call.ts:83](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/src/command-pick-call.ts:83)).

Keep descriptions static and render the current-choice indication separately. Description changes **do not make rows unpickable**; matching uses ID and label.

**F3 — P2, reasoned: the tests omit the most consequential activation paths.**  
The proposed list checks typing and one Light activation ([plan:74](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/docs/plans/261005d-theme-commands-in-the-command-bar.md:74)). It could miss an incorrect Dark/System runner or an accidental `opensOnly: true`, which permits immediate model-picked activation ([CommandBar.tsx:1131](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/src/web/CommandBar.tsx:1131)).

Add focused checks that:

- All three destinations have distinct IDs, survive `knownOptions`, and set their advertised values.
- A confidence-1 model pick draws the appearance row without changing anything until a fresh Enter.
- A refused storage write updates the current-choice indication while retaining the explanation.
- Activation works through the owner’s Metadata command bar.

**F4 — P3, established: the substring inventory is inaccurate.**  
The plan says no existing alias contains `light` ([plan:30](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/docs/plans/261005d-theme-commands-in-the-command-bar.md:30)), but Search’s `highlight` does ([mode-catalog.ts:313](/home/greg/code/spideryarn2/.claude/worktrees/fbc5wdn7-theme-command-in-bar/src/mode-catalog.ts:313)). Correct the claim. This does not establish a ranking defect.

Using the proposed words with the real matcher, no existing full label or alias changed its winning row. `highlight` still selects Search; the promised appearance queries rank correctly. The three direct destinations are reasonable, and nothing in activation requires every press to change state. `stay` also fits storage refusal: colours change, and the persistence limitation remains visible.

Six existing unit files passed: **118 tests passed**, with two catalogue-writing tests skipped. No files changed.

VERDICT: build with the changes above