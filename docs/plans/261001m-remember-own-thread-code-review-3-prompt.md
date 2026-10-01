# Narrow check: 261001m — the fix for R2-1 that came after round 2

Review AND fix in this worktree; do not commit. Discovery is closed: check ONLY commit `7d019ca8b`
(`git show 7d019ca8b`), which replaces your round-1 C1 and round-2 R2-1 reducer fixes with a
product-side gate. The reasoning is in `docs/plans/261001m-remember-is-its-own-single-thread.md` §
Code review: what Sol found, and the one place I took a different route.

The gate: Remember's Start over is offered (and `onDelete` acts) only when `isSettled(state, id)`
in `src/web/chat/model.ts` — not in `unnamed`, in `base` with at least one message, and no
non-load operation for that thread id. `src/web/chat/reduce.ts` is back to commit `46e9f57a1`.

Questions, and only these:
1. Does the gate close C1 (Start over wedging on a loading placeholder) and R2-1 (a DELETE sent to
   a provisional id the server folded elsewhere) in every path — including a thread that came back
   from F3 coalescing in `withServerIds`, a thread with a `pending` row from another tab or a dead
   process (not an op in this tab), and Live (C2's stop-then-delete, where the stop's flush adds a
   spoken op for the thread after the gate was checked)?
2. Can `settled` (a `useCallback` over `state`) be stale at the moment `onDelete` runs?
3. The landscape composer cap moved from 0.45 to 0.3 × innerHeight in `boxSize` — any test or doc
   still saying 45%?

Severity P0–P3, IDs N-1…, file:line, fixed or not, proving test. Client vitest only (no
Postgres/network).
