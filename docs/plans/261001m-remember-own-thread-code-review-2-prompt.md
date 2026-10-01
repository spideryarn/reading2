# Code review (round 2, narrow): 261001m — the round-1 fixes

Review AND fix, in this worktree; do not commit. This round is limited to commit `7ab05e350`
(`git show 7ab05e350`) — the round-1 reviewer's own fixes (C1–C3 in
`docs/plans/261001m-remember-own-thread-code-review-sol.md`), which nobody else has reviewed. Do not
reopen general discovery on `46e9f57a1`.

Specific questions:

1. **Batching between `setResetting("deleting")` and `remove(...)`** in
   `src/web/modes/conversation/ConversationModes.tsx` (the Start over handler, after `await
   live.stop()`). `deleting` comes from `useChat`'s controller (check how it is subscribed —
   `useSyncExternalStore` or state). Is there any render, especially after the `await`, where
   `resetting === "deleting"` and `deleting === false` before the delete op registers, so the
   "back to idle" effect fires early and the "begin a fresh one" effect starts a new thread while
   the DELETE is still in flight (the F1 P0 again)? If so, fix it (e.g. a ref recording that the
   delete op was observed, or deriving from the op id), red first.
2. `forgetLocalThread` / `releaseUnstoredDelete` in `src/web/chat/reduce.ts`: can they drop an
   operation or tombstone that belongs to something else, or send a DELETE for a thread id the
   server has since reassigned to another conversation?
3. The `resettingNow` ref guards: any path (Live start from the composer, a handoff) not covered?

Severity P0–P3, IDs R2-1…, file:line, fixed or not, and the proving test. You have no Postgres or
network; run vitest on the client files only.
