Verdict: **ship**. I found three issues, fixed all of them, and found no P0/P1 defects.

### Findings

- **P2 — [ModeSurface.tsx:112](/home/greg/code/spideryarn2/.claude/worktrees/fbhf4svm-mode-header-and-gutter-icons/src/web/ModeSurface.tsx:112):** `profile` without `mode` was accepted and then silently discarded. Added a TypeScript constraint requiring `mode` whenever `profile` is supplied.
- **P3 — [gutter-control-card.test.tsx:159](/home/greg/code/spideryarn2/.claude/worktrees/fbhf4svm-mode-header-and-gutter-icons/tests/gutter-control-card.test.tsx:159):** live tooltip rewording tested Copied and More→Close, but not the previously requested copy-failure case. Added the missing “Couldn’t copy” regression test.
- **P3 — stale comments:** corrected obsolete trailing-slot/native-title descriptions in [GlossaryPanel.tsx:319](/home/greg/code/spideryarn2/.claude/worktrees/fbhf4svm-mode-header-and-gutter-icons/src/web/GlossaryPanel.tsx:319), [QuotesPanel.tsx:711](/home/greg/code/spideryarn2/.claude/worktrees/fbhf4svm-mode-header-and-gutter-icons/src/web/QuotesPanel.tsx:711), [glossary.css:50](/home/greg/code/spideryarn2/.claude/worktrees/fbhf4svm-mode-header-and-gutter-icons/src/web/styles/glossary.css:50), and [gutter.css:666](/home/greg/code/spideryarn2/.claude/worktrees/fbhf4svm-mode-header-and-gutter-icons/src/web/styles/gutter.css:666).

### Earlier eleven findings

All eleven were implemented as the revised plan says:

1. Rendered badge presence uses `:has(> .prof-badge)` and both profiled/unprofiled fixtures are tested.
2. Corner specificity resets the coarse-pointer 2.5rem badge floor.
3. Empty heads retain the corner, with a corner-height minimum.
4. No wrapper was added; `(i)` remains first and the badge second.
5. Tooltips support mouse hover and keyboard focus, but not touch.
6. `data-tip` mutations refresh the open card without a loop, leak, or stale source; all three changing states are now tested.
7. Positive and negated thresholds are 52/80/108px with matching rem values.
8. Gutter cards use `TipNote`, include `.blk-cmt`, and omit duplicate `aria-describedby`.
9. Tests require `data-tip`, reject native `title`, and cover hover/focus.
10. Sketch remains explicitly deferred as planned.
11. Failed permalinks stay red; `.block-chat.has` stays blue at rest and becomes orange on hover/focus.

The CSS cascade is correct for the marked one-slot row, failures, existing-chat state, direct hover, keyboard focus, and touch-selected rows. `layout.ts` only accounts for gutter width, not vertical slot capacity. Search’s zero-slack layout remains unchanged; Outline and Structure measure the remaining layout live. The three edited project docs are accurate.

### Verification

- Requested Vitest run: **4 files, 157 tests passed**.
- Typecheck: passed all four projects and all 2,693 covered files via `node --import tsx scripts/typecheck.ts`.
- `git diff --check`: passed.
- Focused lint: no errors; only existing complexity and intentionally empty-fragment advisories.
- Full `npm test` could not start because the sandbox cannot connect to local Postgres (`EPERM 127.0.0.1:54362`).
- Fixes remain uncommitted because the sandbox exposes the worktree’s Git metadata read-only, preventing creation of `index.lock`.