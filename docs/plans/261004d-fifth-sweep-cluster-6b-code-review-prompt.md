# Review: four store contracts tightened and two live markers moved, as built

You are reviewing code that is committed on this branch and not yet pushed. You have write access
to this worktree. **Fix what you find inside the scope below**, and report anything wider for me to
decide. Do not commit, do not push, do not run `npm run deploy` in any form.

Repo: this worktree, branch `worktree-sweep5-c6b-referee-search-contracts` (TypeScript, ESM).

## The candidate

One commit: `37a078408`, on top of `b8a8e1c3c`. See it with

    git show --stat 37a078408
    git diff b8a8e1c3c 37a078408

The plan it was built from, with your own plan review beside it:
`docs/plans/261004d-fifth-sweep-cluster-6b-store-contracts-require-the-attempt-and-markers-outlive-finish.md`
and `docs/plans/261004d-fifth-sweep-cluster-6b-plan-review-sol.md`.

## What it is meant to do

1. **X5.** `runRefereeCriterion` and `runRefereeClaims` in `src/routes.ts` hold their live marker
   (`refereeing`, `pullingClaims`) from the pending row until the answer is stored, release it only
   if the request is still its holder, and do not leave it pinned when `sse(res)` throws. This is
   `search`'s shape, copied.
2. **D3.** In `src/store/contracts.ts`: attempt tokens required on `CommentStore`, `ChatStore`,
   `SearchStore`, `RefereeCriteriaStore`; `appendSpoken` returns `StoredExchange`;
   `SearchFinish` and `CriterionFinish` are done-or-error unions; `CommentStore.patch` takes
   `AnswerFinish` (`src/comments.ts`); `ClaimsFinish` is cut to the fields a finish writes. The
   adapters (`src/store/pg-searches.ts`, `pg-referee-criteria.ts`, `pg-chat.ts`, `pg-comments.ts`)
   follow, and keep their run-time refusals.

No behaviour a reader sees should change except the marker's lifetime.

## Scope you may edit

The files in the commit, and no others: `src/routes.ts` (only the search, referee-criteria,
referee-claims, comment-answer and chat-finish code), `src/store/contracts.ts`, the four adapters,
`src/store/pg-referee-claims.ts`, `src/comments.ts`, the four test files, and the plan. Another
agent takes `src/routes.ts` next for unrelated deletions, so leave everything else in it alone.

## The evidence I have

- `npm run typecheck`: green. Before the contract change, with only the new test file added, it
  reported 16 errors in `tests/store-contracts-require-attempts.test.ts`: 12 unused
  `@ts-expect-error` directives and 4 `string | undefined` assignments.
- `npx vitest run tests/referee-stream-lifetime.test.ts`: the five new cases were red before the
  `routes.ts` change (messages: "a sweep between the model and the store buried the answer:
  expected 'error' to be 'done'" twice, "the key was pinned" / "the slug was pinned" expected
  'pending' to be 'error', "the older run took the newer run's lock with it: expected 'error' to be
  'pending'"), and all 14 are green after.
- 13 suites, 370 tests green: the lifetime file, `store-searches-pg`, `comment-sweep`,
  `referee-criteria-store`, `store-pg-referee-claims`, `store-chat-pg`, `store-comments`,
  `referee-routes-postgres`, `store-wiring`, `chat-spoken-route`, `event-times`, `routes`, and the
  new compile-time file.
- The full suite has not been run.

## What I want from you

Independent pass first: read the diff as if nobody had told you what it does. Then:

1. Does any change alter stored data or a response for a caller that was valid before? In
   particular the adapters' `SET` clauses: the old code wrote each field only when the patch
   carried it, and the new code writes one arm of a union. Find a caller, a test double, a script
   or an eval where the two differ.
2. Is each of the five lifetime tests red for the reason it claims and not another, and can any of
   them pass with the fix removed? Try it: revert one hunk at a time, run the file, put it back.
3. Is anything in `tests/store-contracts-require-attempts.test.ts` a directive that suppresses a
   different error from the one its comment names?
4. Are there remaining comments, in the files in scope, that still explain these signatures by the
   filesystem store or say a token is optional?
5. Is the looser parameter type on `pgChatStore.finish` (it accepts no options, so an untyped
   caller reaches `MissingAttempt`) the right call, or does it hide something?
6. **Check my conclusion as well as my code:** the plan says a Criteria holder overlap cannot
   happen in one process, and that Claims' can. Is either statement wrong?

Severity: P0 data loss, security, wrong charging, service unusable · P1 user-visible wrong
behaviour or an authoritative contract violated · P2 design or maintainability risk · P3 prose.
Mark each finding *established* or *reasoned*, give each an ID, and say for each whether you fixed
it. Run `npm run typecheck` and the lifetime test file after your edits and report both results.
End with a verdict.
