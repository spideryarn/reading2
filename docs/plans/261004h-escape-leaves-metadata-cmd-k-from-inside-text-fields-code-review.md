Three P3 findings fixed. All **167 tests across the four permitted files pass**.

1. **P3 — Escape misses the legacy IME signal.** Focus a button on Metadata and dispatch `Escape` with `keyCode: 229` and `isComposing: false`: it navigated away despite the IME refusal. Smallest fix: use `isImeComposing(e)`. The regression test went red, then green. This demonstrates an event-contract gap; ordinary composition inside a text field was already protected.

2. **P3 — Tests missed two regressions.** The original **“leaves Ctrl-K in a text field to the field on a Mac, and takes ⌘-K”** passed with the old blanket typing refusal restored: it never pressed focused ⌘-K. Removing `TitleEditor`’s marker also left **“stands down in a field marked data-command-bar=off”** green. I added focused ⌘-K assertions and real-title-editor coverage for both pages; removing the marker now fails both tests. The plain-`k` and Metadata refusal tests also pass with the feature reverted, appropriately as negative controls.

3. **P3 — Help overstates when shortcuts act.** Focus the title editor and press ⌘-K, or focus a Mac text field and press Ctrl-K: neither opens the bar, contrary to the unqualified Help sentence. An empty Metadata text field also keeps Escape. I qualified those statements and corrected the feedback note’s claim that two native dialogs cannot coexist.

No capture/`show()` refusal race or reachable Metadata Escape ordering conflict found. A second ⌘-K preserves the open bar’s query and remains unclaimed. `MacIntel` is handled correctly, including the intended iPad case. Both title locations use the marked shared input.

**good with the fixes I made**

Files changed:

- [src/web/Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/src/web/Dock.tsx)
- [src/web/help/help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/src/web/help/help-topics.tsx)
- [tests/command-bar.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/tests/command-bar.test.tsx)
- [tests/metadata-chord.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/tests/metadata-chord.test.tsx)
- [Feedback note](/home/greg/code/spideryarn2/.claude/worktrees/fb-metadata-escape-cmdk-icon/docs/user-feedback/261004_1121-escape-leaves-metadata-cmd-k-from-text-fields-and-a-metadata-icon.md)

No commits made.