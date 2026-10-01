Reviewed and fixed without committing.

- **R2-1 — P1 — fixed:** An unnamed Remember thread could be non-empty or already reassigned server-side. The reducer could either forget it locally—dropping unrelated operations/tombstones—or send DELETE to its provisional ID, succeeding as a no-op. [reduce.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/web/chat/reduce.ts:281)
  - Local deletion now requires a genuinely empty thread with no scoped operation or tombstone.
  - Pre-`begin` deltas retain the naming turn.
  - If the turn ends without confirming the stored ID, Start over is visibly refused and restored rather than guessing a destructive ID.
  - Proving tests: [chat-reduce.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/tests/chat-reduce.test.ts:2061). The red reproduction showed the old reducer emitting `DELETE guess-thread`.

- **Batching question — no finding:** `useChat` uses `useSyncExternalStore`; `remove()` updates the controller snapshot synchronously before notifying React. There is no await between `setResetting("deleting")` and `remove()`, so a render reads the registered delete—or a delete that has genuinely settled. [useChat.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/web/useChat.ts:400)

- **`resettingNow` coverage — no finding:** typed sends, list sends and Live starts are guarded. Pending Live startup is cancelled by reset’s `current = null`; handoffs only reach Chat, while Start over exists in Remember.

Verification:

- Focused client Vitest: **83/83 passed**
- Broader related client Vitest: **166/166 passed**
- Client and test TypeScript projects passed
- Independent review of the fix: no findings
- No commit created

The pre-existing untracked review prompt was left untouched.