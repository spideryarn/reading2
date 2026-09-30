# Code review: 260930f — per-article AI cost on the metadata page (admin)

You are reviewing the CODE built from a plan you already reviewed. Repo root is the current
directory, a git worktree on branch `worktree-feedback-68-cost-estimates`.

- The plan, with a section "What changed after the plan review" saying what was done with each of
  your six plan-review findings: `docs/plans/260930f-article-cost-on-the-metadata-page.md`
- Your plan review: `docs/plans/260930f-article-cost-on-the-metadata-page-review-sol.md`
- The scoped diff: run `git diff origin/dev -- . ':(exclude)drizzle/meta/*_snapshot.json'`
  (origin/dev is already merged into this branch, so this is only this work).

## House workflow: you fix what you find

Fix what you find **inside this work's scope** directly in the working tree (do not commit, do not
run any git command that changes history or the index). Report anything wider, or any product
decision, as a finding for me to decide instead of fixing it. Keep edits minimal and in the
surrounding style (long explanatory comments are the house style; match them).

Do NOT edit: `.env.local`, `infra/`, anything under `docs/reusable/`, security defences listed in
`docs/project/security-map.md` § Where the defences physically live (the `/api/admin` namespace
gate, `slugPart`, `requireUser`, `ownedSlug`/`publicSlug`), or `tests/owner-isolation.test.ts`.
Do not call any paid provider; do not run `npm run test:paid`.

## What to check hardest

1. `src/routes.ts`: `dispatchAuthRoute` + `attributableSlug` + the `article` field on all 94 rows.
   Is every row's value right? (`"first-capture"` must mean capture 1 is an article slug; `"none"`
   rows must not be article routes that spend; `"handler"` rows must really wrap.) Does wrapping
   change any status code, error, streaming lifetime or ordering? The route contract test is
   `tests/authenticated-api-route-contract.test.ts`.
2. `GET /api/admin/articles/:slug/cost` and `ownedArticleIdentity` (src/store/pg.ts): ownership is
   checked before any spend is read; the ambient owner inside the handler is the admin.
3. `spendForArticle` / `belongsTo` / `silentLiveSessionsForArticle` (src/store/ai-calls-spend-pg.ts):
   correctness of the predicate, SQL mapping (`mapWith`), and agreement with `totalRows()`.
4. `src/web/ArticleCost.tsx` + Metadata wiring: honest copy (a floor when unpriced; 5.5% on
   credits only), failed-fetch path, admin-only rendering.
5. `evals/cost/ledger-check.ts`: can it pass while something is wrong (silent success)?
6. Tests: can any of them pass vacuously? Would each go red if its subject broke?
7. Docs: `docs/project/cost-tracking.md` claims vs code.

Gates you may run (they are free): `npm run typecheck` (judge by exit code), and scoped vitest:
`npx vitest run tests/route-spend-attribution.test.ts tests/admin-article-cost-route.test.ts
tests/article-cost-section.test.tsx tests/dictation-spend-attribution.test.ts
tests/authenticated-api-route-contract.test.ts tests/ai-calls-spend-pg.test.ts`.

## Output

Write findings to the output file as a numbered list, severity P0–P3, each with file:line, what is
wrong, and either "FIXED: <what you changed>" or "NOT FIXED: <why / what I should decide>". End with
a list of every file you edited, and a one-line verdict: SHIP / SHIP AFTER MY FIXES / DO NOT SHIP.
