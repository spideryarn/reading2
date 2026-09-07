## Findings

- **F1 — P2 — Escape/backdrop closure does not clear the draft before the next paint.** [`CommandBar.tsx:177`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/CommandBar.tsx:177) clears the draft in a passive effect after reopening, while Escape’s `close` event and backdrop click only call `onClose` at [`CommandBar.tsx:227`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/CommandBar.tsx:227). Reopen therefore calls `showModal()` in the layout effect while the previous query is still rendered; a stale result—or `No command matches.`—can flash for one frame before the passive reset. This also fails the stated “Escape closes and clears” contract. Use one close-and-reset callback for Escape, backdrop, and activation, or reset synchronously before `showModal()`. Add an Escape/backdrop → reopen regression test.

- **F2 — P2 — The Dock button bypasses the drawer precedence rule.** The shortcut closes the drawer before opening at [`Dock.tsx:1065`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:1065), but `show()` only sets the command-bar state at [`Dock.tsx:1077`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:1077), and the Dock button calls that directly at [`Dock.tsx:2107`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:2107). Because the non-modal drawer deliberately leaves the Dock operable, clicking Commands while Questions is open leaves both open and reintroduces the capture-phase Escape collision. Centralize the full opening policy—close drawer, reject another native modal, then open—and use it for both entry points. The current test covers only the shortcut and only verifies that `onPanel(null)` was called.

- **F3 — P2 — Ctrl/Cmd-Shift-K is incorrectly claimed as Ctrl/Cmd-K.** [`Dock.tsx:1063`](/home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:1063) excludes Alt but not Shift, so it prevents the browser default and opens the bar for a different chord; notably, Ctrl-Shift-K is Firefox’s Web Console shortcut. Reject `shiftKey` while retaining uppercase `e.key` support for Caps Lock, and add a modifier test.

## Checked and cleared

- The activation extraction exactly preserves the old order: `armActivationForMode(slug, next, { diagram })`, then `onMode(next)`. Both surfaces receive that same callback.
- Diagram context is derived through `diagramInSearch(search)` and passed correctly. Sketch, Illustrated, Force, Drift, and Trail all passed the real-spend matrix.
- The cost-parity test is the requested parameterization of the existing full-App phase-A harness—not a second weaker harness. It asserts URL/mode, queued steps, direct paid POSTs, and pending-token settlement for both triggers.
- `modeGenerates()` is total through `Record<Mode, ModeActivation>`, marks both `fixed` and `delegated`, correctly marks all Diagram paths, and exposes only a boolean—not the table.
- Experimental visibility is shared by construction; hidden modes are not independently rediscovered by the command bar.
- `rankModes()` is deterministic for the Dock’s unique input list, explicitly breaks ties by input index, and neither drops nor duplicates entries. `mode-catalog.test.ts` imports the matcher’s actual `canonical()`.
- `CommandBar` does not import `Dock`; `npm run cycles` passes.
- Native-dialog focus trapping/restoration, combobox/listbox semantics, `aria-activedescendant`, and the Dock opener’s `aria-haspopup="dialog"` are structurally correct.
- The bar is absent from real routes without an actionable reading mode.

Verification: TypeScript passed; the cycle gate passed; the scoped suite had **248 passing tests**. Its sole failure was the instructed-to-ignore read-only-filesystem fixture write in `client-imports.test.ts`. No P0 or P1 findings.