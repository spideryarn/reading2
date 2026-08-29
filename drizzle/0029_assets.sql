-- The article's own images: one JSONB manifest column, and the `assets` step
-- that fills it. docs/plans/hosting-the-articles-images.md, stage B.
--
-- The column sits on `article_revisions` beside `arc`, `glossary` and the rest,
-- for the reason src/db/schema.ts gives on all of them: the artefact carries
-- its own provenance (`version`, `sourceHash`), and splitting it would leave
-- the step unable to say whether the article has moved underneath its images.
--
-- **Nothing here touches `raw_sources`**, and that is deliberate rather than an
-- omission. The bytes of each stored image are a content-addressed object in
-- the `sources` bucket; `raw_sources` exists so a revision can foreign-key to
-- *the document* it was made from, and an image is not the document. So its
-- `raw_sources_kind` CHECK — `in ('pdf','html')` — stays exactly as it is.
--
-- The step CHECK is dropped and re-added rather than altered, because Postgres
-- has no ALTER for a check expression. `assets` is a `StepName` (src/types.ts),
-- so a step run recorded for it would be rejected without this — the failure
-- `'summary'` and then `'ideas'` each caused once by being left out.

ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "assets" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','toc','assets','arc','tweets','glossary','summary','ideas'));
