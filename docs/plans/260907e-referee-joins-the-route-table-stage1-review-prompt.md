# Review prompt — Stage 1 as built: the referee stream-lifetime tests

You reviewed the plan for this work and returned six P1s
(`docs/plans/260907e-referee-joins-the-route-table-review-sol.md`). This is the **built code** for
Stage 1. Weight this review higher than the plan review: a plan-stage review cannot find a test that
passes for the wrong reason.

## What to read

- `tests/referee-stream-lifetime.test.ts` — the new file, in full. This is the subject.
- `tests/store-migration-registry.ts` — the lane entry and the registry entry it needed.
- `docs/plans/260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md`
  § *Stage 1, as built* — the mutation results.
- `src/routes.ts`: `runRefereeCriterion` (~`:4140`), `runRefereeClaims` (~`:4276`), `runMirror`
  (~`:4384`), the `refereeing` (`:3980`) and `pullingClaims` (`:4221`) sets, `sweepCriteria`
  (`:4014`), and the eight referee guards (`:8319`–`:8459`).
- `src/store/pg-referee-criteria.ts` `sweepPending`, and `src/store/pg-referee-claims.ts` `sweep`.

## What I did with your six findings

1. **Invalid lock oracle** — fixed. Rows are backdated past the grace (`ageTheCriteria`,
   `ageTheClaimsRun`) before the mid-stream GET, so the age guard cannot be what spares them.
2. **Handshake** — fixed. Each stubbed generator calls `arrive()` after its first frame and blocks;
   no case inspects anything before `await gates.X.reached()`. Settlement is an explicit `settled`
   boolean set by a continuation attached where the promise is created, not a race.
3. **Propagation** — fixed. `refereeCriteriaStore.begin` is made to reject, which is upstream of
   `runRefereeCriterion`'s catch.
4. **All three streams** — done. Criteria and claims each get lifetime *and* their own lock oracle;
   mirror gets lifetime only, since it holds no lock.
5. **Pure-move evidence** — that is Stage 2 and is not in this diff.
6. **AST `requireUser` check** — that is Stage 3 and is not in this diff.

Mutations run against the **unmoved** routes, each red on its own assertion: `await`→`void` in the
criteria guard (2 cases red); `refereeing.delete(key)` deleted (1 red); the release moved above the
blocked work (1 red).

## The questions

Answer each, P0/P1/P2/P3 for anything you would change.

1. **Does any case pass for a reason other than the one its name claims?** This is the whole
   question. In particular: is `ageTheCriteria`/`ageTheClaimsRun` genuinely sufficient to remove the
   age guard as an explanation, or is there a third thing sparing those rows?
2. **Is the `settled` boolean sound?** It is set in a `.then` attached to the `handleApi` promise at
   creation. Can `settled()` read `false` for a request that has in fact already answered — a
   microtask-ordering hole between the handler finishing and the continuation running — and would
   that make a *broken* implementation pass?
3. **Is `arrive()` in the right place in each generator?** It fires after the first `yield`. Is there
   a path where the route ends the response *before* the generator is entered, so the handshake
   never fires and the case hangs to timeout rather than failing with a message?
4. **The claims lock oracle.** Claims sweeps on `createdAt` and criteria on `attemptStartedAt`. I
   backdated the column each sweep actually reads. Confirm, and say whether the claims case would
   survive its own equivalent of mutation 2 — I did **not** run a claims-specific mutation, and I
   want to know if that is a real gap.
5. **The mirror case has no lock and no store assertion** — only "unsettled while blocked, ended and
   settled after". Is that enough to catch a launched-and-resolved mirror closure in Stage 2?
6. **Is stubbing all three generators at module level via `vi.mock` + `importOriginal` safe here** —
   specifically, does spreading the real module and replacing one export risk losing a module-scope
   side effect these modules perform at import?
7. **The registry entry** claims `mechanisms: ["fixture-loader"]` and no ledger row, on the grounds
   that every generator is stubbed so no model is called. Check that against what the routes actually
   do — `withSpendAttribution` still wraps the call.
8. **Anything that will break when Stage 2 moves these guards into `AUTH_ROUTES`** — the file is
   meant to be untouched by that move. Is anything in it coupled to the guards' current form?

Do not review the plan's slice choice; that is settled. Do not suggest restructuring the file for
style.
