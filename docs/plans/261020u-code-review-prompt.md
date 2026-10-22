Code review, with permission to fix what you find inside this change (workspace-write). Repo: this worktree.

The change: Backspace presses the "back to <section>" way-back chip while it shows. Plan: docs/plans/261020u-backspace-takes-the-way-back.md (read the final sections); your plan review: docs/plans/261020u-build-review-sol.md.

Diff: run `git diff HEAD -- src tests docs` in this worktree. Files: src/web/ReturnChip.tsx (isWayBackKey, the listener in VisibleReturnChip, the ⌫ span), src/web/key-chord.ts (isPlainKey, isAppSurfaceOpen), src/web/TermJump.tsx and src/web/DockQuickSearch.tsx (moved onto isPlainKey/isAppSurfaceOpen; must be behaviour-preserving except for ignoring dialogs inside .prose), src/web/styles/dock.css, tests/return-chip.test.tsx (new describe "Backspace presses the chip"), docs/project/keyboard.md, src/web/help/pages/keyboard.md (and the regenerated src/help-corpus.generated.json).

Look for: correctness bugs; a listener that fires when it should not, or fails to fire in the reporter's case (a press on a Structure section, then Backspace); any way the key acts twice or acts on the × button; whether the listener re-subscribing on every render matters; stale or wrong comments and docs; tests that would pass against a broken implementation. After any fix, run `npx vitest run tests/return-chip.test.tsx tests/term-jump-from-a-paragraph.test.tsx tests/dock-quick-search.test.tsx` and `npm run typecheck`.

Write your findings, numbered with severity, saying for each whether you fixed it (and how) or are leaving it for me to decide. End with a line VERDICT: ship | ship after my fixes | do not ship.
