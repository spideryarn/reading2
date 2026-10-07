# Review: a plan for eight small deletions in and around `src/routes.ts`, before it is built

You are reviewing a plan before it is built. Read-only: do not edit any file.

Repo: this worktree, branch `worktree-sweep5-c8-routes-deletions` (TypeScript, ESM). Base
`origin/dev` at `0a98b28ab`.

## The candidate

Live pre-commit: one untracked file,
`docs/plans/261004e-fifth-sweep-cluster-8-routes-deletions.md`. Nothing else has changed.

Read the plan, then the code it changes: in `src/routes.ts` the header comment (lines 1-128), the
`AUTH_ROUTES` table and every `withSpendAttribution` call inside it, `dispatchAuthRoute` and
`attributableSlug`, the catch in `serveApi` (search for `ENOENT`), `slugPart`, `sse` and its ten
callers; `slugFrom` in `src/public/routes.ts`; `isAllowed` and `requireUser` in `src/auth.ts`;
`admitOrResync` and `chargeAndSwitchOnHighPower` in `src/billing/admission.ts`;
`findCitation` in `src/store/index.ts`; `tests/authenticated-api-route-contract.test.ts`
(`readTableEntry`, `EXPECTED_AUTH_ROUTES`), `tests/citation-find-route.test.ts`,
`tests/citation-investigate-route.test.ts`, `tests/billing-high-power.test.ts`,
`tests/store-migration-registry.ts`.

The evidence: `docs/investigations/261003b-fifth-sweep-server-request-layer.md` (R4, R5, R7, R9,
R10, R11), `docs/investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md` (X6, X7,
X8), your own earlier review `docs/investigations/261003b-fifth-sweep-review-sol-on-server-and-web.md`,
and row 8 of `docs/plans/261003f-fifth-codebase-sweep-umbrella.md`.

## What it is meant to do

Delete things that say one thing twice or describe code that is gone. Two named behaviour changes
only: an `ENOENT` thrown inside a request becomes a reported 500 instead of a 404 carrying the raw
message; and the two "Not a slug" 400s stop echoing the value.

## What I want from you

Independent pass first. Is each deletion safe: is anything that would break unnamed (a caller in
scripts, tools, evals, the client, a test or a registry that lists a deleted file, a doc that names
a deleted thing)? For R4: is each of the 16 inner wraps really equivalent to the dispatcher's, or
does any row attribute a different slug, or run paid work before or outside the wrap in a way the
dispatcher's wrap changes? Would each red-first test be red today and green after, for the stated
reason? Is any piece not worth its keep, or missing?

Severity: P0 data loss, security, wrong charging, service unusable · P1 user-visible wrong
behaviour or an authoritative contract violated · P2 design or maintainability risk · P3 prose.
Mark each finding *established* (direct evidence) or *reasoned*. Give each an ID, F1, F2, ….
End with a verdict: ready, ready with these fixes, or not ready.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. R7: deleting `tests/citation-find-route.test.ts` removes Postgres-composition coverage (a stored
   find read back onto its entry; a link the article gave wins; the reading dropped when `why`
   changes). Does `tests/citation-investigate-route.test.ts` cover the same store behaviour, or
   should some cases move rather than die?
2. R7: is deleting `findCitation` from `src/store/index.ts` right, or does something outside `src`
   build on it?
3. R9: is there any intended producer of `ENOENT` in a request path left (the filesystem readers
   `loadThreads`, `loadComments`, `loadRuns`, `loadShelf`, `loadLookups` are said to be test-only)?
4. X8: retargeting `security-map.md`'s two pointers from `isAllowed` to `requireUser` is meant to
   change a pointer and not a rule. Is it?
5. X7: does `admitOrResync` log or throw anything different from the hand-rolled branch that a
   test or a log reader depends on?
