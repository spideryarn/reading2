**Verdict: land with fixes (made).** Changes are uncommitted.

Eight scoped findings fixed, each reproduced red first:

- **D1 P1:** Enter handoffs overwrote earlier submissions and used later words. Now queued with sealed text. [search-draft.ts:96](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/search-draft.ts:96)
- **D2 P1:** StrictMode erased handoffs before loading completed. Consumption now survives effect replay. [SearchMode.tsx:246](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/modes/search/SearchMode.tsx:246)
- **D3 P2:** Article or mode departure retained executable handoffs. Cleanup now discards pending actions while retaining words. [DockQuickSearch.tsx:176](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/DockQuickSearch.tsx:176)
- **D4 P2:** An old dock timer could ask before the latest pause. Band takeover now cancels local waiting. [DockQuickSearch.tsx:103](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/DockQuickSearch.tsx:103)
- **D5 P2:** Responsive CSS could hide the focused input. Focus now transfers after layout settles. [DockQuickSearch.tsx:146](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/DockQuickSearch.tsx:146)
- **D6 P2:** The gate ignored the independent visitor flag. Both visitor signals now suppress the control and shortcut. [Dock.tsx:2141](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/Dock.tsx:2141)
- **D7 P3:** Unfocused input events could write the draft. Actual focus is now required. [DockQuickSearch.tsx:184](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/DockQuickSearch.tsx:184)
- **D8 P2:** C7 could fall through to retry a failed meaning row. Revision requests now bypass retry. [searches.ts:200](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/searches.ts:200)

**D9 P2, wider scope—reported only:** The existing panel submits Enter during IME composition. Confirmed by reproduction; left unchanged. [SearchPanel.tsx:638](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/src/web/SearchPanel.tsx:638)

**Validation:** 124 targeted/doc-link tests and 34 adjacent tests passed. Typecheck and scoped lint passed. A broader run passed 309 tests; one CSS-import check hit sandbox `EPERM`, and its equivalent scan passed separately. Browser and PostgreSQL checks remain unverified.

[Full review, including each exact red-first test](/home/greg/code/spideryarn2/.claude/worktrees/quick-search-bar/docs/plans/261002h-quick-search-bar-in-the-dock-code-review-sol-3.md)