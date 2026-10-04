## Findings

- P0: none.
- P1: none.
- P2, fixed:
  - The Metadata assertion rejected `.on`, radio, checked, and pressed states, but not `aria-current`. It now rejects all selected/current semantics at [dock-fit.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqerga4-metadata-bottom-bar/tests/dock-fit.test.ts:546).
  - The “marked × experimental” matrix passed even if `DockModeLinks` dropped every visitor mark. It now verifies the visible marked links at [dock-experimental-modes.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbqerga4-metadata-bottom-bar/tests/dock-experimental-modes.test.tsx:471).
  - The shared-frame test did not verify the reading arm’s nested radio-wrapper share or carried Marginalia with Experimental off. Both are now covered at [dock-fit.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqerga4-metadata-bottom-bar/tests/dock-fit.test.ts:563).
  - Comments falsely described today’s links as loose and implied three frames were unconditional. Corrected in [Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbqerga4-metadata-bottom-bar/src/web/Dock.tsx:2804) and [dock-fit.css](/home/greg/code/spideryarn2/.claude/worktrees/fbqerga4-metadata-bottom-bar/src/web/styles/dock-fit.css:15).

The implementation itself is correct:

- `DockModeLinks` produces the same non-empty frame partition, order, run separators, counts, labels, tooltips, and marks at [Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbqerga4-metadata-bottom-bar/src/web/Dock.tsx:3019).
- The tablet flex split is equivalent. The reading wrapper receives the sum of its enclosed radio shares and redistributes it by the same frame counts; the links arm gives those shares directly to the frames. Both levels use the same `0.3rem` gap. There should be no visible spare-width difference.
- Losing direct-child `.dock > .dock-btn` matching is harmless: `.dock-modes .dock-btn` supplies the same coarse-pointer growth at [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fbqerga4-metadata-bottom-bar/src/web/styles/narrow-window.css:803). No quick-search selector reaches the mode frames.
- The fit ladder measures only the root’s `scrollWidth/clientWidth`; it makes no direct-child assumption at [dock-fit.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbqerga4-metadata-bottom-bar/src/web/dock-fit.ts:171). `fitSignature` still distinguishes the two arms and all width-changing state.
- The remaining exact `dock-mode` occurrences outside plans are historical comments and mutation witnesses, not live selectors.
- Plain `div` frames add no misleading widget semantics. Links retain explicit accessible names, and the inset focus outline remains visible inside `overflow: hidden` at [dock-fit.css](/home/greg/code/spideryarn2/.claude/worktrees/fbqerga4-metadata-bottom-bar/src/web/styles/dock-fit.css:139).
- No edited documentation misquotes the report; I added no quotation attributed to Greg.

## Changed

Review fixes touched:

- `src/web/Dock.tsx`
- `src/web/styles/dock-fit.css`
- `tests/dock-fit.test.ts`
- `tests/dock-experimental-modes.test.tsx`
- `tests/dock-mode-tooltips.test.tsx`

No production behavior was changed by the review fixes. `DockQuickSearch` was untouched, and nothing was committed.

## Verification

- Affected suites: 128/128 passed.
- Five adjacent Dock regression files: 168/168 passed.
- Typecheck: passed for all projects.
- Targeted lint: passed with only pre-existing advisory complexity/specificity warnings.
- `git diff --check`: passed.
- Full `npm test`: could not start because the sandbox cannot reach Postgres/Docker on `127.0.0.1:54362`.
- The complete unit lane was attempted but hit unrelated sandbox-sensitive process, FIFO, network, and CLI-wrapper failures; it was not treated as a valid gate.
- A real 1024px coarse-pointer browser pass was not run; that is the only optional validation left.

Verdict: SHIP AFTER FIXES APPLIED