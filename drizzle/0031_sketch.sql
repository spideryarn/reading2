-- Sketch: the picture a model draws of the argument — docs/project/diagram.md
-- § Sketch, docs/plans/sketch-diagram.md.
--
-- One JSONB column beside `ideas` and `summary`, for the reason src/db/schema.ts
-- gives on all of them and which is sharper here than anywhere: a scene is a set
-- of coordinates that only means anything against the article it was drawn for.
-- Every node may carry a block id, a re-extraction moves every block id, and a
-- column without `sourceHash` and `profileHash` could not answer whether the
-- picture is still about this text.
--
-- **The second statement is hand-written and `drizzle-kit generate` did not
-- produce it.** Drizzle diffs the schema and knows nothing about this CHECK, so
-- the generated file was one `ADD COLUMN` and nothing else — which would have
-- been the THIRD time this constraint was left behind: `'summary'` the first
-- time, `'assets'` in 0029, and `'sketch'` here. A step run recorded for a step
-- the constraint does not list is rejected at insert, and the way that fails is
-- a job dying somewhere far from this file.
-- `tests/db-step-constraint.test.ts` is what makes there not be a fourth.
--
-- Dropped and re-added rather than altered because Postgres has no ALTER for a
-- check expression.

ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "sketch" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','toc','assets','arc','tweets','glossary','summary','ideas','sketch'));
