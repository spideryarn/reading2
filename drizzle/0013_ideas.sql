-- Ideas: the propositions a reader has to hold — stage 5f.
-- docs/plans/ideas-mode.md.
--
-- One JSONB column beside `glossary` and `summary`, for the reason
-- src/db/schema.ts gives on all three: the artefact carries its own
-- provenance (`sourceHash`, `profileHash`) and splitting it would leave
-- the panel unable to answer whether the article has moved underneath it.
--
-- The CHECK is dropped and re-added rather than altered because Postgres has
-- no ALTER for a check expression. `ideas` is a `StepName`, so a step run
-- recorded for it would be rejected without this — which is the failure
-- `'summary'` already caused once by being left out.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "ideas" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','toc','arc','tweets','glossary','summary','ideas'));