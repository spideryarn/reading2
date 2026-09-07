NONCE: LIFETIME-ORACLE-4A

Verdict: stage 4a is sound and pushable. No P0, P1, or P2 findings. Keep this test unchanged through the criteria move and require it to pass afterward.

### Finding

- **P3-CASE-ISOLATION** — The rejection case’s final comment says the paper is empty, but it expects one row because it relies on residue from the preceding case ([test:490](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/streaming-route-request-lifetime.test.ts:490)). Consequently, running that case alone would fail. Comparing the row count before and after would make it independent. This does not weaken the main assertions.

### Answers

1. **Step 3 proves the lock is held.** After backdating, every sweep predicate except `notInArray(id, keep)` is satisfied: correct article, `pending`, and older than the cutoff ([store:393](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/store/pg-referee-criteria.ts:393)). Therefore, its survival means its ID is in `liveCriteria(slug)`, which is derived directly from `refereeing`.

   The converse is a good positive control: the same helper and same sweep-relevant arrangement subsequently produce `CRITERION_SWEPT` ([test:457](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/streaming-route-request-lifetime.test.ts:457)). That also rules out the backdating update silently targeting nothing.

   Preserving `attemptId` is correct. `finish` fences on `pending` plus that exact attempt ([store:333](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/store/pg-referee-criteria.ts:333)), and the test requires a stored result and a `done` frame ([test:441](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/streaming-route-request-lifetime.test.ts:441)). A broken fence cannot silently pass.

2. **Mutation 3 targets the right rejection.** `begin` is before both SSE and `runRefereeCriterion`’s intentional catch ([routes:4147](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:4147)). Deferring its rejection with `setImmediate` genuinely tests whether the returned promise remains connected to the request.

   **At stage 4a it does not yet exercise `dispatchAuthRoute`.** Criteria still matches the chain guard at [routes:8331](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:8331). It currently proves propagation through the guard’s `await`, `serveAuthenticatedApi`, and `serveApi`’s catch. Once criteria moves into the table, the unchanged case will exercise the dispatcher’s awaited handler calls at [routes:7063](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:7063). That post-move green is when the dispatcher half is discharged.

3. **I agree with Fable: this is once, not per domain.** No separate lifetime oracle is required for chat, searches, claims, or Mirror. Their locks/streams live inside their helpers; a verbatim caller move cannot alter those lifetimes. The remaining move-specific risks are covered by:

   - the body/order diff catching a non-verbatim move;
   - the static awaited-handler check;
   - this unchanged asynchronous rejection case passing through `dispatchAuthRoute` after criteria moves.

   A domain-specific test becomes necessary only if its helper or caller responsibilities change—not for the mechanical table migration described here.

4. **The main test cannot pass after its subject silently stops.** It requires `frame:done`, response end, resolution in that order, and the stored `done` result. Only `runCriterionStream` is mocked; the real begin, lock add/delete, `finally`, finish fence, SSE writing, dispatcher path, and outer request promise remain exercised. The gates remove timing dependence, and I see no green-path load-sensitive race.

I confirmed `src/routes.ts` is byte-identical across the commit and ran the permitted unit lane: **325/325 passed**. I did not run the Postgres-backed lifetime test and relied on the supplied results and mutations. No files were modified.