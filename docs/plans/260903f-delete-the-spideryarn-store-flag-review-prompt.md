# Review the plan to delete `SPIDERYARN_STORE` and the filesystem store

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag` (a git worktree of
Spideryarn, branch `worktree-delete-store-flag`). Read `AGENTS.md` at its root first — it is the
working agreement.

**The plan:** `docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md`

You reviewed the *question* earlier today ("can we get rid of SPIDERYARN_STORE?") and answered
"yes, but staged". This is the plan written from your answer and Fable's. **Do not simply confirm
it** — your earlier answer is one of its inputs, so agreeing with yourself is the failure mode here.

## Context

The ancestor is `docs/plans/260831b-finish-the-database-move.md` § *Appendix: the cleanup that
remains*. The new plan claims that appendix is stale in eight places and structurally wrong in one
(that stage D is "one line in `guarded()`" when there are ~20 `STORE ===` sites across 10 files
outside `src/store/index.ts`, several of them feature gates rather than store selection).

This is an alpha with no real users; brief breakage is acceptable, design quality is not negotiable.
Several agents share one tree and one local Supabase. The repo's chronic failure class is **silent
success** — a check that agrees with the bug (`docs/reusable/silent-success.md`).

## What I want

1. **Is the staging right?** B (convert ~29 ungated route suites) → B′ (delete filesystem-behaviour
   suites) → C (13 `createFsArtifactStore` doubles) → C′ (two prerequisites: a test-scoped Postgres
   cost ledger, and a fixture seeder replacing `copyArtefacts`) → D (the atomic hinge) → E–H (delete
   adapters) → J (docs). Is any stage in the wrong place, too big to review, or missing?

2. **Is stage D's contents complete?** It carries: the ~20 `STORE` sites, `guardDbStore` moving onto
   each Postgres export, database readiness failing closed, the `attempt` tokens becoming required,
   the tombstone, and the glossary decision. What else must be inside that one commit, and is
   anything in it that should be outside?

3. **The two prerequisites in C′.** Are they correctly identified, and is either harder than the
   plan implies? Specifically: `src/store/ai-calls.ts`'s `NODE_ENV === "test"` redirect (which
   exists because route tests once wrote 4,714 fixture rows into the dev ledger), and
   `tests/helpers/load-article.ts:427` → `copyArtefacts` → `npm run db:seed-dev`.

4. **The negative control.** The plan requires stopping/misdirecting Postgres and watching the
   default test run fail with the expected message. Is that sufficient proof that the database
   really became required, or is there a way for it to pass while the suite is still silently
   skipping?

5. **What would go wrong that the plan does not anticipate?** Especially anything that would report
   success while doing nothing, or any coverage that disappears in a way indistinguishable from
   migration succeeding.

6. **Anything factually wrong in it.** Check the counts and the file/line claims against the code
   rather than against my prose. If the plan repeats a mistake from the ancestor's appendix, say so.

## How to work

Read-only; do not edit files. You may run a single test file (`npx vitest run tests/<one>.test.ts`)
or a `node --import tsx` script; do not run `npm test` or `npm run typecheck`.

Give a clear verdict — ready to build / ready with changes / not ready — and be concrete and brief.
