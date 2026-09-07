NONCE: JOBS-TABLE-3B

Verdict: the production move is behavior-preserving, but I found one P1 in the new contract reader. Fix that before pushing. The focused suite passes 319/319.

## Findings

- **P1-MUTABLE-MATCHER-RESOLUTION — the whitelist does not enforce `const`.** [`literalConstants`](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/authenticated-api-route-contract.test.ts:1199) accepts every top-level `VariableDeclaration`; it never checks `statement.kind === "const"`. Thus this is silently accepted:

  ```ts
  let P = /^\/api\/safe$/;
  P = makePattern();
  const AUTH_ROUTES = [{ kind: "pattern", method: "GET", pattern: P, handler: async () => {} }];
  ```

  The reader records `/safe`; runtime dispatch uses `makePattern()`’s result. The added `const P = new RegExp(...)` case correctly refuses that exact shape, but does not prove the documented immutable-literal contract. [`readRouteTable`](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/authenticated-api-route-contract.test.ts:1287) similarly claims `AUTH_ROUTES` is a `const` without checking the declaration kind.

  Require `statement.kind === "const"` in both readers and add negative `let`/`var` cases. Also require the shared matcher declaration to precede `AUTH_ROUTES`: declarations after use currently resolve syntactically, although a real `const` then fails through TDZ/typechecking. Local shadowing is not possible at this module-scope use site; mutable or duplicate top-level declarations are the real hole.

- **P2-ORDER-ORACLE — the new order test is a regression pin, not independent evidence of the migration.** The expected order at [`authenticated-api-route-contract.test.ts:1810`](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/authenticated-api-route-contract.test.ts:1810) was introduced with the arrangement it approves. It would equally have approved a mistaken initial ordering had its author written both together.

  I independently compared the table with `468d1eeb^`: the nine rows exactly preserve the old sequence, including `GET /api/jobs` before uploads and `POST /api/jobs` after them. So stage 3b itself is correct, and the test is now useful protection against later tidying.

  The old order no longer exists in current source. It survives only in Git history and prose. For future slices, capture and commit an ordered fixture/test while the guards are still in the chain, observe it green, then perform the move without changing that oracle.

- **P2-DISPATCH-RAIL-SCOPE — the one-dispatch default is right, but “absolute” overstates it.** [`readTableDispatch`](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/authenticated-api-route-contract.test.ts:960) refuses a second recognized top-level dispatch. It does not count calls nested inside an existing guard body or elsewhere in the module.

  Keep the blanket refusal for now: supporting unused slice machinery would add complexity prematurely. When a non-contiguous domain genuinely needs a slice, permit an explicitly named slice table at its recorded position while retaining “the complete `AUTH_ROUTES` is dispatched exactly once.” If the rail is meant literally, independently scan AST call sites for every `dispatchAuthRoute` invocation.

- **P2-LIFETIME-BEHAVIOUR — Referee is the next streaming slice, but Mirror is not its first streaming guard.** `POST criteria` at [`routes.ts:8321`](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:8321) calls `runRefereeCriterion`, which opens SSE and holds `refereeing`; Claims POST also streams and holds `pullingClaims`; Mirror POST at [`routes.ts:8417`](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:8417) calls [`runMirror`](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:4374), which opens SSE but has no live-run lock.

  Before moving Referee, add the integration test against the still-chain-based Criteria POST:

  1. Enter through `handleApi` with `runCriterionStream` paused after the pending row and SSE `begin` frame.
  2. Prove the `handleApi` promise remains unsettled and the response has not ended.
  3. Issue the corresponding GET and prove its sweep leaves the row `pending`, demonstrating that `refereeing` remains held.
  4. Release the stream, then require the terminal frame, store finish, response end, lock removal, and only then `handleApi` resolution.
  5. Keep the separate deferred-handler rejection-propagation check from the earlier finding.

  One nuance: stage 3b already moved the deliberately long-lived, lease-owning `jobAdvance` handler. Its awaits are correct, but under the earlier finding’s literal “streaming/stateful” wording, request-lifetime integration coverage was already due here.

## Move verification

The nine handlers are semantically unchanged. `part(upload, 1)` → `part(captures, 1)` is correct because the dispatcher passes the same raw `RegExpExecArray`. All meaningful inner returns in POST `/api/jobs` remain. Removing only each arm’s final `return;` is safe: the closure resolves, `dispatchAuthRoute` returns `true`, and `serveAuthenticatedApi` returns. Rejections still propagate through the dispatcher to `serveApi`’s existing catch.

No production dispatch or authorization defect was found in the moved code. No files were modified.