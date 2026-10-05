ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "reading_language" smallint;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "reading_ideas" smallint;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "reading_difficulty_reason" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "reading_difficulty_model" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "reading_difficulty_rated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD CONSTRAINT "article_revisions_reading_language" CHECK ("spideryarn"."article_revisions"."reading_language" between 1 and 5);--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD CONSTRAINT "article_revisions_reading_ideas" CHECK ("spideryarn"."article_revisions"."reading_ideas" between 1 and 5);--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD CONSTRAINT "article_revisions_reading_difficulty_all_or_none" CHECK (num_nonnulls("spideryarn"."article_revisions"."reading_language", "spideryarn"."article_revisions"."reading_ideas", "spideryarn"."article_revisions"."reading_difficulty_reason", "spideryarn"."article_revisions"."reading_difficulty_model", "spideryarn"."article_revisions"."reading_difficulty_rated_at") in (0, 5));