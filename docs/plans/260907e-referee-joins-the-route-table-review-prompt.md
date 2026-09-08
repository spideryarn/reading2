# Review prompt — referee joins the route table

You are reviewing a **plan, before any code has been written**, for a refactor inside a file that is
on this project's security defence list. Be adversarial. I would rather hear that the slice is wrong
than have you improve its prose.

## What you are reviewing

`docs/plans/260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md`
in this repository. Read it in full first.

Read also, because the plan is a continuation of it and inherits its decisions:

- `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md` — the landed work. You
  reviewed its plan already. Its § *Where stage 3 stands, and what the next slice costs* specifies
  the slice my plan implements, including the integration test you required.
- `src/routes.ts` — specifically `AUTH_ROUTES` (`:6667`), the `AuthRoute` types (`:6556`–`:6599`),
  `dispatchAuthRoute` (`:7063`), `serveAuthenticatedApi` (from `:7130`), the five referee matcher
  declarations (`:7469`–`:7486`), the eight referee guards (`:8319`–`:8459`), and the dispatch call
  (`:8460`).
- `runRefereeCriterion` (`:4140`) and the `refereeing` lock (`:3980`, `:4149`, `:4177`);
  `runRefereeClaims` and `pullingClaims` (`:4221`, `:4284`, `:4315`).
- `tests/authenticated-api-route-contract.test.ts`, particularly `assertHandlersAwaited` (`:1131`).
- `tests/referee-scan-route.test.ts:325`–`:360` — the source-reader that must be re-pointed.
- `tests/referee-criteria-routes.test.ts:100`–`:181` — the harness Stage 1 copies.
- `docs/project/security-map.md` and `docs/project/auth.md` for the defence claims.

## The constraints the plan must satisfy

1. **One bounded slice**, safe to abandon. If nobody touches this again for a month, what lands must
   still leave the codebase better.
2. **A pure move, provably** — identical exports, identical handler bodies, the diff readable as a
   move. Demonstrated, not asserted.
3. **Exactly one `requireUser` call site must survive.** `security-map.md` names "the one
   `requireUser` call" as the property it relies on. Two call sites breaks it even if every route is
   still guarded.
4. `tests/routes.test.ts`, `tests/owner-isolation.test.ts`, `tests/public-dto.test.ts` are the
   specification and must stay green, and the plan must be able to say why each still tests what it
   tested.
5. `src/public/routes.ts` is dispatched **before** `requireUser`, read-methods only, no owner ever
   set. That ordering must not be disturbed.
6. No new machinery. The table already exists; this adds rows to it.

## The questions I actually want answered

Answer each explicitly, and say P0/P1/P2/P3 for anything you would change.

1. **Is referee the right slice?** The plan argues it is the *only* slice that is a pure move today,
   because the table is dispatched from one fixed point at the bottom of the chain and only the
   contiguous block immediately above it can move without reordering. Is that reasoning sound? Is
   there a cheaper slice I have wrongly rejected — and if the reorder for a non-adjacent domain is
   genuinely unobservable given the "no two guards accept the same method and path" assertion, say
   so, because that would make a much easier night available and I have chosen against it.

2. **Is the Stage 1 lifetime test the right test, and does it actually prove what I claim?** I assert
   the `handleApi` promise is unsettled by racing it against a resolved sentinel. Is that sound, or
   can it pass vacuously? Is observing the `refereeing` lock through a second `GET` request a real
   check, or is there a way that GET reports `pending` for a reason unrelated to the lock? Name a
   cheaper test that would catch the same defect, if one exists.

3. **Is my mutation plan sufficient to show the test can fail?** I plan two: dropping the `await` in
   the chain guard, and deleting `refereeing.delete(key)`. Is there a third mutation that a correct
   version of this test must catch and mine would not — in particular, a moved handler that
   *launches* the stream and returns a resolved promise?

4. **The three streaming handlers, individually.** `criteria` POST and `claims` POST both stream and
   hold a lock; `mirror` POST streams and holds none. Stage 1 covers criteria only. Is covering one
   of the three enough to move all three, or does claims need its own case? I have assumed the lock
   mechanism is shared enough that one proves the pattern. Push back if that is the same
   shape-for-lifetime substitution I am criticising in `assertHandlersAwaited`.

5. **Have I missed a way the move changes behaviour?** Specifically: the chain evaluates all five
   referee matchers eagerly on **every** authenticated request, whereas the table evaluates a row's
   pattern only after its method matches. Is that observable anywhere — a regex with side effects, a
   `lastIndex` on a `/g` flag, a throw? I believe all five are pure and unflagged, but I want it
   checked rather than believed.

6. **Is the `requireUser`-appears-once source-reader assertion (Stage 3) worth adding, or is it a
   test that will misfire?** It reads `src/routes.ts` and counts a call. Comments mention
   `requireUser` six times; my count must exclude the import and the comments. Is a source-reader the
   right instrument here at all, or is there a structural check that would be harder to fool?

7. **Is stopping after Stage 1 genuinely defensible**, as the plan claims? I want to know whether the
   test alone is a coherent artefact or whether it only makes sense as scaffolding for the move.

8. **The brief I was given said "no route table"**, and I am adding rows to one because Greg named a
   table as the shape and you endorsed it for the sibling plan. Is following the landed shape right
   here, or should a plan that contradicts its own brief have stopped and asked?

## What I am not asking

Do not redesign the table, propose a router library, or suggest a different decomposition of
`src/routes.ts` as a whole. That question was settled with your review of 260907b. Do not comment on
prose or doc structure unless a document states something about the code that is false.
