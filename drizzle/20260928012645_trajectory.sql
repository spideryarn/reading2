-- Trajectory: a route through the article's Quotes, walked at three depths —
-- stage 1 of docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md.
--
-- One column and a constraint.
--
-- `article_revisions.trajectory` is one JSONB column beside `quotes` and `faq`:
-- the WHOLE artefact. It holds quote ids and no block ids — a stop reaches its
-- passage through the quote in the `quotes` column beside it.
--
-- **The CHECK is hand-kept in src/db/schema.ts.** `drizzle-kit generate` emitted
-- the DROP/ADD pair below from the literal in the schema once that literal had
-- been widened by hand. `tests/db-step-constraint.test.ts` compares the last
-- `ADD CONSTRAINT` here with `STEP_ORDER` in both directions.
--
-- Nothing narrows: `'trajectory'` is only ADDED and every existing name stays,
-- so there is no `revision_step_runs` row this can fail to validate against.
--
-- **`IF NOT EXISTS` on the column, added by hand to what drizzle generated.**
-- On 2026-09-28 the shared local database carried a peer worktree's unlanded
-- migration (`20260928010007_jobs_reset`), so `db:migrate` here refused, rightly,
-- and this DDL was applied to the LOCAL database directly to run stage 1's real
-- runs. Idempotent so that the ledger's own run of this file, once both land,
-- is a no-op there rather than an `already exists` for whoever migrates next.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN IF NOT EXISTS "trajectory" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','hierarchy','labels','assets','arc','tweets','glossary','quotes','trajectory','ideas','timeline','quiz','faq','sketch','illustrated','debate','citations'));