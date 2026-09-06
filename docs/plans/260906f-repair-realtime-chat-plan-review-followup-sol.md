# READY

No established P0/P1 remains.

- **F1 — CLOSED.** `94ddccd42` deliberately wired Live into open Review conversations and used `labelled={review}`; `028676677` explicitly preserved this during Review→Remember. The contradictory “not built” statement is stale inventory. Preserving open-thread Remember Live while limiting new list-level create-and-start to Chat introduces no new regression. The plan also correctly excludes new Remember stance semantics ([plan](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/docs/plans/260906f-repair-realtime-chat.md:47)).
- **F2 — CLOSED.** The plan requires ownership transfer at optimistic-row registration, recovery on failure, and a deferred-append test ([plan](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/docs/plans/260906f-repair-realtime-chat.md:24)).
- **F3 — CLOSED.** Deadlines are explicitly epoch-owned, cleared on every exit/replacement, and covered by the A-stop-B-old-deadline scenario ([plan](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/realtime-chat-repair/docs/plans/260906f-repair-realtime-chat.md:25)).

**Remaining adjustment:** None. Correcting the obsolete documentation and testing the Chat/Remember distinction are already required by the plan.

Base `28096583db9a5cbee322e0f0936e54aeaaea86eb` confirmed. No tests run, per scope.