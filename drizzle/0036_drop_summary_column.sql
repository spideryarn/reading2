-- Stage 5e is gone (docs/plans/gist-only-summaries.md). Summary mode draws the
-- one-sentence gists that were always on the tree, so the generated ladder, the
-- column that held it and the step that wrote it all go.
--
-- Greg, 2026-08-31: "We're still in Alpha, so we don't care about the data we
-- have right now. So if we don't need a column going forwards, let's discard it
-- to keep things tidy."
--
-- **The DELETE is not optional and it has to come before the ADD CONSTRAINT.**
-- Postgres validates a re-added CHECK against the rows already in the table, so
-- narrowing `revision_step_runs_step` while a single `summary` step run exists
-- fails the whole migration with a 23514. Any database that has ever run the
-- summary step has such rows.
ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
DELETE FROM "spideryarn"."revision_step_runs" WHERE "step_name" = 'summary';--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" DROP COLUMN "summary";--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','toc','assets','arc','tweets','glossary','quotes','ideas','timeline','sketch'));
