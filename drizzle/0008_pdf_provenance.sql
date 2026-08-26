ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "raw_sha256" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "extract_method" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "pages" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "unverified" boolean;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "recall" double precision;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "pages_checked" integer;