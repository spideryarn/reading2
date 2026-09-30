-- Simple: a plain-words orientation to the piece, a sub-mode of Summary —
-- stage 1 of docs/plans/260930i-simple-summaries-eli15-sub-mode.md.
--
-- One column and a constraint, the shape of 20260930122442_crossrefs.sql.
--
-- `article_revisions.simple_summary` is one JSONB column beside `faq` and
-- `crossrefs`: the WHOLE artefact, because `sourceHash` is what says whether
-- the article moved underneath it.
--
-- **The CHECK is hand-kept in src/db/schema.ts.** `drizzle-kit generate` emitted
-- the DROP/ADD pair below from the literal in the schema once that literal had
-- been widened by hand. `tests/db-step-constraint.test.ts` compares the last
-- `ADD CONSTRAINT` here with `STEP_ORDER` in both directions.
--
-- Nothing narrows: `'simple'` is only ADDED and every existing name stays, so
-- there is no `revision_step_runs` row this can fail to validate against.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "simple_summary" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','hierarchy','labels','assets','arc','tweets','glossary','quotes','trajectory','ideas','timeline','quiz','faq','sketch','illustrated','debate','citations','crossrefs','simple'));