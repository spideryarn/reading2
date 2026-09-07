The catalog split is sound, and deferring `AppAction` is sound. I would not build Stage 2 unchanged, however: it currently omits the command bar’s pre-spend disclosure and leaves several interaction/parity details ambiguous.

## Findings

**F1 — P0 — Paid mode activation has no pre-spend disclosure.**  
[plan:155](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260906h-mode-catalog-and-a-command-bar.md:155>), [plan:176](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260906h-mode-catalog-and-a-command-bar.md:176>)

The rows contain only label, aliases and description, but Enter can immediately start paid work. Diagram alone can spend about $0.20 and two minutes ([diagram.md:178](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/project/diagram.md:178>)), while its proposed description merely says that a model draws it ([Dock.tsx:688](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:688>)). The governing brief explicitly requires the ordinary mode row to disclose readiness/cost before the spend-authorising press ([design brief:199](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260905e-mode-catalog-and-command-bar.md:199>), [design brief:235](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260905e-mode-catalog-and-command-bar.md:235>)).

This does not require changing Greg’s decision: Enter should still behave exactly like the Dock button. Instead, add an explicit pre-submit effect/cost line for modes that may generate when missing, sourced from a browser-layer total adapter rather than folded into the catalog’s descriptive copy. If exact readiness is too expensive for v1, the row must at least disclose the worst-case conditional cost and wait honestly.

**F2 — P2 — “The same two lines” is duplicated execution, not one execution path.**  
[plan:157](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260906h-mode-catalog-and-a-command-bar.md:157>), [Dock.tsx:1724](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:1724>)

Calling the same two functions currently gives the same activation semantics, but it creates two places that must remain paired and ordered. The Dock click also conditionally blurs pointer activation at lines 1740–1743; the plan does not discuss the command bar’s corresponding close, draft-clear and post-selection focus behavior.

Have `Dock` define one `activateMode(next)` callback containing `armActivationForMode(...)` and `onMode(next)`, and pass it to both `DockModes` and `CommandBar`. Each surface can then retain its own presentation behavior: the Dock’s pointer blur, and the command bar’s close/clear/focus transition. This gives one execution path without prematurely introducing `AppAction`.

**F3 — P2 — Importing `visibleModes` from `Dock.tsx` would create a component cycle.**  
[plan:140](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260906h-mode-catalog-and-a-command-bar.md:140>), [plan:153](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260906h-mode-catalog-and-a-command-bar.md:153>), [Dock.tsx:1061](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:1061>)

If Dock imports `CommandBar`, while `CommandBar` imports `visibleModes` from Dock, the implementation has a direct circular dependency and makes the new component depend on the whole 2,354-line Dock module.

Keep `visibleModes` where it is. Dock already computes `visible`; pass `visible.map(row => row.mode)` into `CommandBar`. That preserves the exact Dock-derived list, avoids changing the five existing test imports, and avoids both the cycle and the large component dependency.

**F4 — P2 — `pendingActivation` does not prove activation/cost parity.**  
[plan:247](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260906h-mode-catalog-and-a-command-bar.md:247>), [every-mode test:793](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/tests/every-mode-draws-its-surface.test.tsx:793>)

The existing exhaustive test explains why a token is not evidence of a post. More decisively, Diagram’s Force, Drift and Trail paths spend through direct mount-time POSTs while leaving no activation token at all ([every-mode test:874](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/tests/every-mode-draws-its-surface.test.tsx:874>)). A `pendingActivation` comparison therefore cannot establish “same cost.”

Exercise the command-bar trigger through the real App harness and assert:

- selected mode/URL;
- queued job steps;
- direct paid requests;
- no unsafe pending tokens after settlement.

Parameterising the existing phase-A trigger is preferable to inventing a weaker second harness. If F2 makes execution shared structurally, representative integration cases can cover `none`, `fixed`, and all delegated Diagram contexts.

**F5 — P2 — Matching and keyboard selection are not specified tightly enough to test.**  
[plan:155](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260906h-mode-catalog-and-a-command-bar.md:155>), [plan:238](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260906h-mode-catalog-and-a-command-bar.md:238>)

“Highlighted row” is used without defining how it becomes highlighted or changes. The plan should state: input autofocus; stable tie-breaking in Dock order; first-result selection; Up/Down movement; reset/clamp after filtering; mouse/touch row selection; Enter behavior; and the listbox/active-descendant accessibility contract. The global shortcut should also ignore repeat, call `preventDefault()` when claimed, and define behavior for inputs, textareas, selects and contenteditable elements.

Put normalization/ranking in a pure function and use that same normalizer in alias collision tests. Otherwise case or whitespace variants can pass the uniqueness test while colliding in the matcher.

**F6 — P2 — The new modal can collide with the Dock drawer’s Escape handler.**  
[plan:145](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/docs/plans/260906h-mode-catalog-and-a-command-bar.md:145>), [Dock.tsx:1088](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/Dock.tsx:1088>)

Cmd/Ctrl-K can open the modal while the non-modal Dock drawer is open. The drawer has a capture-phase window Escape handler which will still handle that Escape. The plan needs an explicit precedence rule—most simply, close the drawer before opening the command bar, and do not open over another native modal.

Also reuse the existing visual-viewport treatment used by Feedback; native `<dialog>` alone does not stay fitted above the iOS keyboard ([FeedbackDialog.tsx:782](</home/greg/code/spideryarn2/.claude/worktrees/worktree-command-bar/src/web/FeedbackDialog.tsx:782>)).

## Checked and cleared

- The five “stays put” decisions are correct: `MODE_LABEL`, icons, `keepLabel`, `POLICY`, and `MODE_TARGET` each have a distinct existing owner.
- Moving `description` and `experimental` is appropriate. A required `experimental: boolean` in a total `MODE_CATALOG` preserves the “new mode must decide” invariant even after it leaves `ModeUi`.
- `modes.ts` should remain the vocabulary owner; deriving `Mode` from descriptive catalog copy would invert the clean dependency.
- Aliases are reasonable for v1. `toc` is exactly the kind of durable destination synonym the feature needs. Keep them sparse; avoid phrases that promise an action the mode does not perform. Their semantics cannot be compiler-checked, but normalization, emptiness and collision can be.
- Deferring the typed `AppAction` vocabulary is right. A shared local `activateMode` callback is sufficient until a second verb creates evidence for the wider dispatcher.
- Mounting from Dock is architecturally sound. The `onMode` guard correctly excludes Metadata, Tweets and public pages, whose mode controls are links rather than local band changes.
- The claimed field-read blast radius is correct: the three reads are `m.experimental` at 817 and `m.blurb` at 1298 and 1694. Five tests import `visibleModes`. Stage 1 will additionally need to add `mode-catalog.js` to the shared-module allowlist in `tests/client-imports.test.ts`.
- I found no new token-cross-spend sequence provided activation and navigation remain synchronous and shared as in F2. Retained tokens after a failed GET and Illustrated retiring unspent without a Sketch are existing guarded semantics, not command-bar-specific faults.
- Both requested baseline files pass: 105 tests across 2 files. No files were changed.