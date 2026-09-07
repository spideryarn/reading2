NONCE: BILLING-TABLE-3A

Verdict: stage 3a is sound. I found no P0 or P1 issue. The focused suite passes 316/316.

## Findings

- **P2-LIFETIME-BEHAVIOUR — `assertHandlersAwaited` is a useful tripwire, not behavioural proof.** It correctly catches removal of either direct `await` in [dispatchAuthRoute](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6779), so it is adequate for billing. But it would still pass if a moved closure launched its stream without returning it, swallowed an error, or released its lock early. Before a streaming/stateful domain moves, add an integration test through `handleApi` that pauses the stream, proves the outer request remains pending and the lock remains held, then releases it and observes completion. A small deferred-handler test should also prove rejection propagation.

- **P2-STAGE3B-ORDER — Preserve position; do not hoist on the present corpus.** Prefer migrating from the bottom upward: take the contiguous guard slice immediately above the existing table call and prepend those rows before billing in their original order. This keeps one call and preserves the total order exactly. If the chosen domain is not a contiguous suffix, dispatch a separate domain slice at its old position. Do not call the complete `AUTH_ROUTES` at several positions—that would let billing match at the first call.

  Hoisting becomes durable only when either:

  - every remaining guard moves into the single table, in original order; or
  - matchers use a restricted representation whose same-method intersections can be checked exhaustively across table and legacy routes.

  A segment-template DSL or structurally enforced namespace partition could provide that proof. The current hand audit plus finite corpus establishes today’s fact, but an intentional widening updates the frozen contract and can still miss a new intersection.

- **P3-CAPTURE-CONTRACT — The discriminated union does not guarantee that pattern routes capture anything.** [PatternAuthRoute](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6567) accepts `/^\/api\/x$/`, despite the comments saying the pattern arm necessarily has captures. This has no effect on stage 3a; soften the claim to “regex route” or encode a stronger matcher abstraction later.

## Verified behaviour

1. **Placement is genuinely order-preserving.** The old billing guards followed `jobAdvance` and preceded the terminal 404. The table call remains in exactly that position at [routes.ts:8363](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:8363). Earlier successful handlers return before it; unmatched and unsupported-method requests traverse it before the unchanged 404. The only timing change is that four pure string comparisons are now performed late rather than eagerly, which is unobservable.

2. **The gates remain ahead of selection.** The order is `assertVerifiedUser` → `setRequestOwner` → `setMonitoringUser` at [routes.ts:6847](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6847), followed by the admin predicate/refusal, then all handler selection. A non-admin `/api/admin…` request still receives 403 regardless of whether its path or method names a route; the table is never reached.

3. **Import-time refusal is the right trade.** A flagged shared regex creates request-history-dependent dispatch. For authenticated routing, failing the module closed is preferable to booting with an intermittently wrong route. It is a programmer/deployment defect, and the unit lane catches it during module import before production.

4. **Awaiting and errors are correct in the landed code.** Both handler forms are directly awaited; `true` is returned only after successful completion. There is no catch in `dispatchAuthRoute`, so rejection propagates unchanged through `serveAuthenticatedApi` to `serveApi`’s existing error boundary. The dispatcher neither sends nor ends responses itself.

5. **`AuthRouteContext` introduces no new authority.** Its `VerifiedUser` contains only the verified id/email, and the request envelope was already lexically available to every inline handler in this same module. Reconsider least-privilege envelopes if handlers later move into separate files, but there is no present leak.

No files were modified.