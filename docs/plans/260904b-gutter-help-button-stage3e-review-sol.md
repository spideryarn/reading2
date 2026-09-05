No. One commit-blocker remains: `gone` is neither a current nor an ID-scoped fact.

1. The timing-only rule is unsound.

- `useChat` makes one GET and never refreshes it. Waiting 180 seconds does not make that snapshot current.
- A failed network GET may become a cached synthetic `200` ([api.ts:616](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/lib/api.ts:616)); chat is cacheable. `loadFailed` is therefore false even though the result may be stale.
- The client timeout does not bound server creation. `streamChat` persists through `chatStore.begin` ([routes.ts:2391](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/routes.ts:2391)) before installing its response-close listener ([routes.ts:2451](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/routes.ts:2451)). The browser can time out while the server later commits.
- `sweepPending` is fine: it changes a pending message to error; it does not remove the thread.

There is also an ID-transfer bug in [ChatDialog.tsx:228](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/ChatDialog.tsx:228): after A times out, `waitedOut` remains true during the first render of missing B. `gone` is computed true for B before the effect resets the boolean, and the `onDropped` effect from that same render can drop B immediately. The current swap test changes IDs before A expires, so it misses this.

2. `gone → onDropped` does not mechanically loop and performs no server deletion. Removing the summary makes `overlay` null and unmounts the dialog. But it is not semantically safe while `gone` can be inferred from stale state: it can hide a live conversation and make the next `?` buy a duplicate.

3. I would not commit yet.

The one required change is: make “gone” an ID-scoped, authoritative resolution—not `old snapshot + elapsed time`. At minimum, store the verdict as an ID rather than a boolean. Because a timed-out write has an ambiguous server outcome, the simplest no-provenance v1 is to stop automatically dropping and show an explicit “Start a new conversation” recovery after the timeout. Automatic dropping requires fresh non-offline revalidation plus a server-side finality guarantee.

I agree with accepting the separate summary-GET duplicate race; its bounded one-duplicate tradeoff is reasonable.

Checks: requested tests passed, 86/86; all three TypeScript projects passed directly; `git diff --check` is clean. The `npm run typecheck` wrapper itself hit a sandbox IPC `EPERM`, not a compiler error.