**Statement 1 remains open; statements 2–5 are closed.** The four permitted suites passed: **99 tests**. No files changed.

**F12 — P2, reasoned:** [useAutosavedText.ts:241](/home/greg/code/spideryarn2/.claude/worktrees/qi-wxt4gtyn-notice-deploy-on-wake/src/web/useAutosavedText.ts:241) calls `lastChance()` before `endLeaveHold()`. If `leave` throws synchronously, release is skipped. A read-only probe reproduced the retained reload veto and `beforeunload` warning after the older save settled. No production occurrence was established. Release needs a `finally`.

Success, older-save rejection, `abandon`, `seed`, and two-hook isolation passed additional read-only probes.

1. **F12 protection and guaranteed release: still open** — synchronous `leave` exception leaks the hold at the path above.
2. **F12 hold ownership: closed** — the per-instance ref prevents duplicate acquisition; epoch checks exclude stale completions.
3. **F18: closed** — safety is checked before claiming the session note or reloading.
4. **F19: closed** — `Object.hasOwn` filters URL keys and recursive fallback keys.
5. **F15 edit: closed** — the current route must be changelog; a destination article cannot be adopted.

**Verdict: not closed.**