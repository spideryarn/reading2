ALTER TABLE "spideryarn"."articles" ADD COLUMN "short_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD CONSTRAINT "articles_short_id_unique" UNIQUE("short_id");