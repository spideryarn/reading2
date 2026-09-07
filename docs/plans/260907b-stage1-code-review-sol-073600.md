NONCE: ROUTE-CONTRACT-1B

Verdict: no P0 or P1 findings. The suite passes 304/304, `src/routes.ts` has no working-tree diff, and neither stage changed it. Stage 1 is a defensible stopping point.

## Findings

- **P2-SAFETY-SCOPE — The refusal gate models only the authenticated dispatcher, while `call()` enters through `handleApi`.** The assertion at [authenticated-api-route-contract.test.ts:1327](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/authenticated-api-route-contract.test.ts:1327) does prevent every current refusal from reaching an authenticated handler. However, `handleApi` first dispatches the public namespace and Stripe webhook at [routes.ts:6347](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6347) and [routes.ts:6371](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6371), neither of which `sourceAccepts()` models.

  Today this is safe: no contract witness lies in either namespace. That should be asserted if this is intended as a durable safety mechanism, or the negative matrix should invoke `serveAuthenticatedApi` directly. Otherwise a future, erroneous authenticated contract row under one of those paths could execute an outer handler despite `sourceAcceptsIt === false`.

- **P2-METHOD-UNIVERSE — “Every refused method” and “no two guards” mean only five verbs.** `METHOD_UNIVERSE` at [authenticated-api-route-contract.test.ts:949](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/authenticated-api-route-contract.test.ts:949) omits at least HEAD and OPTIONS. This does not endanger today’s matrix, and pair equality catches an uncoordinated new verb. But if source and contract deliberately gained another verb, the collision check would silently omit it. Either assert that every contract/source method belongs to this closed universe or derive the collision methods from the guards and add HEAD/OPTIONS explicitly to the refusal policy.

- **P2-DISJOINTNESS-CLAIM — Useful check, but not the universal property its headings advertise.** The implementation candidly admits the finite-corpus limitation at [authenticated-api-route-contract.test.ts:1239](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/authenticated-api-route-contract.test.ts:1239), so this is not hidden. Still:

  - A set does not “record” source order. The literal table preserves matcher declaration order for a human reader, but it neither asserts that order nor represents the global order of all 81 guards.
  - The library and chat tests genuinely preserve two known cross-method matcher intersections and would catch useful narrowing mutations.
  - The job test at [authenticated-api-route-contract.test.ts:1300](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/authenticated-api-route-contract.test.ts:1300) demonstrates only three sample paths; it does not prove two regex languages disjoint and adds little beyond the corpus check.
  - The general corpus check is not theatre. Its synthetic collision exercises the positive branch, while the real empty case connects the actual parsed guards and corpus. Its value is modest but real.

  I independently checked the pinned patterns: the only distinct-matcher intersections are library-search/shelf-entry and chat-thread/live-tool, both separated by method; job action and advance are disjoint. Because exact regex sources are pinned, current order is genuinely irrelevant. I would not assert order now. A future intentional matcher change must, however, trigger a fresh intersection review; this corpus alone cannot justify later reorderings.

- **P3-OVERLAP-COMMENT — “Fourteen matchers overlap” is factually wrong.** At [authenticated-api-route-contract.test.ts:1025](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/authenticated-api-route-contract.test.ts:1025), fourteen matchers have multiple accepted methods; only two pairs of distinct matchers overlap.

## Answers to the specific questions

1. **The current negative matrix is safe.** `expect(...).toBe(false)` throws before `call()`, and the source model exactly matches the present guard predicates. The file does intentionally send handled requests: two `/api/models` positive controls and four malformed decode-order requests. The latter fail before any store/provider call. Admin-route requests using the stranger verifier are stopped by the admin gate.

2. **The module-scope refusal is loud enough.** A failed file collection with the custom `serveAuthenticatedApi: … at line …` error is unambiguous and guarantees no derived tests run against a partial inventory. Moving it into a test would improve test-count cosmetics but weaken the fail-closed structure.

3. **The disjointness machinery earns its place, with narrower claims.** The two overlap-preservation cases are particularly valuable; the general corpus is a useful lint-like tripwire, not proof. The job-family test is mostly explanatory redundancy.

4. **No current order assertion is needed.** Exact pinned patterns plus the structural audit establish that order is non-behavioural today. The test should stop saying a set “records” guard order, and future matcher changes need explicit re-audit.

5. **All current dispatcher statements are classified loudly.** Independent AST inspection found exactly:

   - 69 declarations: 67 matchers, the request destructure, and the admin namespace
   - 82 top-level `if`s: 81 guards and the admin gate
   - 4 top-level calls
   - 1 terminal return
   - 0 parse errors or unsupported statement kinds

   The five-reader classification in the plan is also accurate.

6. **Stopping after Stage 1/1b is defensible.** It leaves a valuable, independent inventory and fail-closed syntax reader without changing production behavior. It does not complete the original refactor, but it is not worse than not starting. I would tighten the P2 safety/method assertions before treating this test as permanent infrastructure or using it to justify later matcher changes.