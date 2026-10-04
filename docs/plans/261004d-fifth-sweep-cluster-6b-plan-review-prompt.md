# Review: a plan to tighten four store contracts and move two live markers, before it is built

You are reviewing a plan before it is built. Read-only: do not edit any file.

Repo: this worktree, branch `worktree-sweep5-c6b-referee-search-contracts` (TypeScript, ESM). Base
`origin/dev` at `b8a8e1c3c`.

## The candidate

Live pre-commit: one untracked file,
`docs/plans/261004d-fifth-sweep-cluster-6b-store-contracts-require-the-attempt-and-markers-outlive-finish.md`.
Nothing else has changed.

Read the plan, then the code it changes: `src/store/contracts.ts` (`CommentStore.beginAnswer` and
`patch`, `Turn`, `ChatStore.finish` and `appendSpoken`, `SearchStore`, `RefereeCriteriaStore`,
`ClaimsFinish`, `MissingAttempt`), the adapters `src/store/pg-searches.ts`,
`src/store/pg-referee-criteria.ts`, `src/store/pg-referee-claims.ts`, `src/store/pg-chat.ts`,
`src/store/pg-comments.ts`, and in `src/routes.ts` the handlers `search` (the repaired shape, with
`searching` and `liveRuns`), `runRefereeCriterion` (`refereeing`, `liveCriteria`),
`runRefereeClaims` (`pullingClaims`), the comment answer path around `beginAnswer`/`settle`, the
chat stream's two `chatStore.finish` calls and the `appendSpoken` caller. The tests the plan builds
on: `tests/referee-stream-lifetime.test.ts`, and the Search precedent in `tests/routes.test.ts`
(search for `liveRuns`).

The evidence: `docs/investigations/261003b-fifth-sweep-data-and-pipeline.md` § D3,
`docs/investigations/261003b-fifth-sweep-review-opus-on-data-and-pipeline.md` § D3,
`docs/investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md` § X5, and the
umbrella `docs/plans/261003f-fifth-codebase-sweep-umbrella.md` (row 6b and paragraph 6b).

## What it is meant to do

Change no behaviour a reader can see, except that a Referee run's live marker is now held until its
answer is stored and is released only by the request that holds it. Everything else is the compiler
refusing what the store already refuses at run time.

## What I want from you

Independent pass first. Is each change right; is anything it would break unnamed (other
implementers or fakes of these contracts, callers outside `src/routes.ts`, scripts, evals); would
each red-first test really be red today and green after, for the stated reason and not another; is
any piece not worth its keep?

Severity: P0 data loss, security, wrong charging, service unusable · P1 user-visible wrong
behaviour or an authoritative contract violated · P2 design or maintainability risk · P3 prose.
Mark each finding *established* (direct evidence) or *reasoned*. Give each an ID, F1, F2, ….
End with a verdict: ready, ready with these fixes, or not ready.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. X5 tests 1 and 2: the wrapped `finish` issues a nested `GET` through `handleApi` from inside
   another request's async context. Does the owner context or spend attribution make that nested
   call see something different from a real second request?
2. X5: moving `sse(res)` inside the `try` means a throw there skips `finish`. Is there any path
   where the pending row is left with no `finish` and no marker, and is that the right outcome (the
   sweep collects it after the grace)?
3. X5 test 3: after the older claims run finishes, its handler calls `refereeClaimsStore.load` and
   frames a superseded error. Does anything on that path touch the newer run's row?
4. D3: is a discriminated union for `SearchFinish` and `CriterionFinish` right, or does an `error`
   finish ever legitimately carry `hits`, `results` or `model` (a partial answer kept on failure)?
5. D3: does anything rely on `Turn.attempt` being `undefined` from `appendSpoken` at run time,
   including the web client's types of the same name?
6. D3: is keeping `MissingAttempt` and the three run-time refusals right once the types forbid the
   call, or is it dead code that should go?
