Removing the machinery was right. Shipping stage 3 without replacing it is not.

1. **This remains commit-blocking.** The spinner defect predates stage 3, but stage 3 creates the permanent dead-button route:

   - The old chat button always opens a fresh draft ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/App.tsx:2506)).
   - The new `?` instead trusts a summary and routes back to its ID ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/App.tsx:2573)).
   - After `?` → close before `begin` → POST failure, that optimistic summary survives while the next `useChat` instance finds no server thread. Every later press reopens the same endless `Starting…`.

   So the removed fixes were wrong, but “chat-lifecycle work” is not grounds for deferring it: stage 3 now depends on that lifecycle. Build the operation-owned version and the lifecycle-real test from the previous review.

2. **The `!loadFailed` condition is correct.** Within `ChatDialog`, I found no second place that mistakes a completed failed load for authoritative absence. However, the copy is too strong: “It is still there” is unknowable after a failed request. Prefer: “Could not load that conversation. We couldn’t check whether it still exists.”

   Adjacent to the panel, `helpAboutBlock` also ignores the summary fetch’s `loaded`/`error` state. A permanently failed summary GET looks like an authoritative empty list and may buy a duplicate. The lifecycle design should either cover that or explicitly gate the paid action.

3. **I would not commit stage 3 now.** The one blocker is: creation provenance/status keyed by thread ID must survive panel unmount and resolve the missing optimistic summary after the 180-second opening window, proved by `?` → close → pre-`begin` failure → reopen.

The requested tests passed, **80/80**. Typecheck passed independently, and `git diff --check` is clean. One test comment is now stale: [help-never-spends-twice.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/tests/help-never-spends-twice.test.tsx:18) still claims the missing-summary case is tested against the real dialog, but that coverage was removed.