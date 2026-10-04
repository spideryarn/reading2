# Review and fix: eight small deletions in and around `src/routes.ts`

You are reviewing built code, and you may fix what you find **inside this change**, narrowly and
red-first (a failing test before the fix). Report, do not fix, anything wider. Do not run any git
command that changes anything; I commit.

Repo: this worktree, branch `worktree-sweep5-c8-routes-deletions` (TypeScript, ESM).

## The candidate

One commit, `__SHA__`, on top of `origin/dev` at `0a98b28ab`. See it with
`git show --stat __SHA__` and `git diff 0a98b28ab __SHA__ -- <path>`. Changed paths:

__PATHS__

Start with `src/routes.ts`, `src/citation-find.ts`, `tests/authenticated-api-route-contract.test.ts`
and `tests/citation-finds-read-back-pg.test.ts`; that does not limit scope.

The plan, with your own plan review's four findings and how each was answered:
`docs/plans/261004e-fifth-sweep-cluster-8-routes-deletions.md` and
`docs/plans/261004e-fifth-sweep-cluster-8-plan-review-sol.md`.

## What it is meant to do

- R5: the route inventory in `src/routes.ts`'s header is replaced by a pointer.
- R4: 16 inner `withSpendAttribution` wraps in `article: "first-capture"` rows are deleted; the
  contract test now refuses such a row.
- R7: `POST /api/citations/:slug/:id/find` is deleted, with `makeFindCitation`, the store's
  `findCitation`, and the route's test; its Postgres checks moved to
  `tests/citation-finds-read-back-pg.test.ts`, its unit cases re-pointed at `runCitationLookup`.
- R9: `ENOENT` in `serveApi`'s catch is no longer a 404; it is a reported 500.
- R11: `slugPart` and the public `slugFrom` say `"Not a slug"` without the value.
- R10: `sse()`'s comment lists what each of the ten streams does when the reader leaves.
- X8: `isAllowed` and the unreachable `[auth-beta]` 403 are deleted; doc pointers retargeted.
- X7: `chargeAndSwitchOnHighPower` uses `admitOrResync`.

## Evidence I ran (you have no Postgres or network; these are mine to hand over)

- `npm test`: __TEST__
- `npm run typecheck`: all four projects pass.
- Red first, observed: the contract rule refused today's table at the first wrap (line 9071);
  the ENOENT test got 404 where it expects 500; both exact `"Not a slug"` assertions got the
  interpolated message. All green after.
- Mutation, observed: bypassing `admitOrResync` in `chargeAndSwitchOnHighPower` fails both stale
  tests in `tests/billing-high-power.test.ts`. The subagent that moved the Postgres cases reports
  three mutations of the new file each went red.

You can run `npx vitest run tests/authenticated-api-route-contract.test.ts tests/citation-find.test.ts
tests/citation-investigate.test.ts tests/public-dispatch.test.ts` yourself; they need nothing
outside the tree.

## What I want from you

Independent pass first. Is any deleted thing still needed; is any comment or doc now false; did the
re-pointed tests keep what they pinned or quietly weaken it; do the doc edits say only what the code
does (and in `docs/project/security-map.md`, an entry-point doc, is only a pointer changed, never a
rule)? The doc edits in `docs/project/citations.md` and `setup-dev.md` were written by a subagent:
check the new wording against the code.

Severity: P0 data loss, security, wrong charging, service unusable · P1 user-visible wrong
behaviour or an authoritative contract violated · P2 design or maintainability risk · P3 prose.
Mark each finding *established* or *reasoned*, give each an ID continuing from the plan review
(F5, F6, …), say which you fixed, and end with a verdict: ready, ready with these fixes, not ready.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. Left dead on purpose, for you to judge whether deleting them belongs here: `CITATION_FIND_BUSY`,
   `CITATION_FIND_LIMITED`, `CITATION_FIND_RESTING` and the `cite-resting` code in
   `src/messages.ts` (and `docs/project/copy.md`'s two mentions); the `"citation-find"` allowance
   bucket in `src/store/contracts.ts` (its DB check constraint in `src/db/schema.ts` would need a
   migration, which is out of scope). If the messages and the contract's bucket comment are a small
   safe deletion, do it; otherwise say what you would do.
2. `tests/citation-investigate.test.ts`'s migrated comparison ("yields exactly what
   runCitationLookup answers, unchanged") may be close to a tautology. Worth its keep?
3. The registry entry for the new Postgres test keeps `mechanisms: ["ledger-redirect",
   "fixture-loader"]` though it makes no provider call.
4. The R10 census in `sse()`'s comment: is each of the ten callers in the right row?
