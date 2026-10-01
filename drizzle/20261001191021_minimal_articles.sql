-- The thin article: a paper on the shelf with only its metadata read.
-- Plan docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md,
-- Stage 3 (§ The thin article). Additive: no stored row changes meaning.
--
--   articles.processing                 'minimal' | 'full', default 'full' — every
--                                       article that exists today is full
--   article_revisions.abstract, .doi    what the `metadata` step read off the paper
--   article_revisions_raw_sha256        the duplicate check's first half, from the
--                                       hash to the article (partial: most old rows
--                                       have no hash)
--   uploads_owner_claimed_sha256        its second half: this owner's other uploads
--                                       of the same bytes
--   revision_step_runs_step             gains 'metadata'. Hand-kept in
--                                       src/db/schema.ts; drizzle emitted the
--                                       DROP/ADD pair from the widened literal, and
--                                       tests/db-step-constraint.test.ts compares it
--                                       with STEP_ORDER. Nothing narrows.
ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "abstract" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "doi" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD COLUMN "processing" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
CREATE INDEX "article_revisions_raw_sha256" ON "spideryarn"."article_revisions" USING btree ("raw_sha256","article_id") WHERE "spideryarn"."article_revisions"."raw_sha256" is not null;--> statement-breakpoint
CREATE INDEX "uploads_owner_claimed_sha256" ON "spideryarn"."uploads" USING btree ("owner_id","claimed_sha256");--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD CONSTRAINT "articles_processing" CHECK ("spideryarn"."articles"."processing" in ('minimal','full'));--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','metadata','extract','blocks','hierarchy','labels','assets','arc','tweets','glossary','quotes','trajectory','ideas','timeline','quiz','faq','sketch','illustrated','debate','citations','crossrefs','simple'));