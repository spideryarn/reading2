Verdict: revise before implementation. No P0, but the proposed lock oracle is invalid, and one criteria case cannot prove all three streaming rows preserve lifetime.

## Findings

- **P1 — The GET does not currently observe `refereeing`.** A fresh pending criterion is protected by the 150-second age condition even when `keep` is empty ([pg-referee-criteria.ts](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/src/store/pg-referee-criteria.ts:384)). Therefore:
  - mid-stream GET reports `pending` with or without the lock;
  - after completion GET reports `done` because `finish` wrote `done`, with or without the lock;
  - deleting `refereeing.delete(key)` will not make the planned assertion fail.

  Advance `Date` beyond `CRITERION_ORPHAN_GRACE_MS` before the mid-stream GET. Then `pending` really means the live-set exclusion protected it. To prove release, create a stale pending row under the same key after completion and require GET to sweep it; the leaked key mutation must leave it pending.

- **P1 — The lifetime assertion needs an explicit reached-and-blocked handshake.** Merely starting `handleApi` and racing it against a resolved sentinel can pass before dispatch reaches the handler. Wait until the generator has yielded and is blocked—preferably also assert the `result` frame exists—then inspect settlement. A race is sound only if the mapped `handleApi` promise is registered before the sentinel; an explicit `settled` boolean observed after the blocked checkpoint is clearer.

- **P1 — The claimed rejection-propagation case is not one.** `runRefereeCriterion` catches a generator failure and converts it to an error row ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/src/routes.ts:4155)). That case proves error conversion and cleanup, not propagation to `serveApi`’s catch. For genuine propagation, defer and reject something outside that catch—`refereeCriteriaStore.begin`, for example—and require the outer request to remain pending until rejection and then answer through the outer error path.

- **P1 — Criteria does not cover claims and mirror.** The three table closures can independently forget to return or await their inner promise. Claims also uses a separate lock, key, store method, and sweep algorithm ([pg-referee-claims.ts](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/src/store/pg-referee-claims.ts:275)); it is not an instance of the criteria mechanism. If referee remains the slice, add:
  - deferred lifetime plus aged-GET lock checks for criteria;
  - the equivalent for claims;
  - deferred lifetime/end-order coverage for mirror.

- **P1 — “Pure move” is asserted, not yet demonstrated.** Stage 2 says byte-for-byte but specifies substitutions and no comparison artefact ([plan](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/docs/plans/260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md:212)). Repeat the previous slice’s mechanical evidence: capture the eight normalized bodies and their order before the move, compare after the move, show `EXPECTED_AUTH_ROUTES` unchanged, and compare exported names before/after. The existing table-order expectation will otherwise be edited in the same commit as the arrangement it blesses.

- **P2 — Referee is only the unique order-preserving suffix, not the unique behaviour-preserving move.** If no two guards accept the same method/path, changing their relative selection order is unobservable. The existing assertion is only a finite corpus, so it is not sufficient proof by itself; however, `glossary/lookup/askTerm` can be proved disjoint exhaustively from intervening routes by its literal `/api/glossary/` namespace. That is a genuinely cheaper non-streaming slice.
  
  The other suggested “non-streaming” alternative is misstated: `quizMark` calls `markOneAnswer`, which opens SSE ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/referee-into-the-route-table/src/routes.ts:7914)).

- **P2 — Add the `requireUser` assertion, but make it AST-based.** Reuse the contract test’s parser and count `CallExpression`s bound to the named `requireUser` import. Also require that the call is inside `serveApi`, before its `serveAuthenticatedApi` handoff. Comments and imports then cannot misfire; a text count should not be used.

## Answers to the eight questions

1. **Is referee the right slice?** Safe, yes; uniquely necessary, no. The fixed-point argument proves only that referee is the sole slice that preserves textual dispatch order. Given true method/path disjointness and pure matchers, reordering is unobservable. `glossary` is the easier defensible slice if its prefix disjointness is recorded as an exhaustive argument rather than inferred from the corpus. **P2.**

2. **Is Stage 1 the right test?** A deferred route-level test is the right instrument, but the proposed lock observation is invalid and the promise check needs synchronization. The cheaper test for lifetime alone is: wait until the generator is blocked, prove response open and `handleApi` pending, release, then prove end and settlement. The lock test is separate and needs an aged row. **P1.**

3. **Are the mutations sufficient?** No. Dropping the guard’s `await` should fail after proper synchronization. Deleting `refereeing.delete` will not fail the proposed test. Also mutate the moved table closure to `void withSpendAttribution(...)`; a correct lifetime test must catch that exact launch-and-resolve defect. Moving lock deletion before the blocked work should also fail the aged-GET check. **P1.**

4. **Is criteria enough for all three streams?** No. Criteria and claims have analogous intentions but separate implementations; mirror tests a third closure without a lock. One representative test would repeat the same shape-for-lifetime substitution the plan criticises. **P1.**

5. **Does eager versus method-filtered matching change behaviour?** Not for these five matchers. They are unflagged regex literals, take a string, have no callbacks or getters, and `/g`/`/y` is already refused. Fewer `exec` calls and module-scope allocation are not application-observable here. No change required.

6. **Is the one-call assertion worthwhile?** Yes. This is precisely the kind of syntactic security invariant a source reader should hold. Use AST binding and enclosing-function checks, not comment stripping or regex counting. **P2.**

7. **Is stopping after Stage 1 defensible?** Yes, once corrected. A deferred request-lifetime and lock-cleanup regression test protects existing production behaviour independently of the table move. As currently described, stopping there would preserve a false lock claim, so the present Stage 1 is not yet a coherent finished artefact. **P1 until corrected.**

8. **Was following the table shape right despite the old brief?** Yes. Greg’s later explicit table decision, the landed implementation, and the instruction to follow the adopted shape supersede the older “no route table” direction. Adding rows introduces no new machinery. No clarification was required.