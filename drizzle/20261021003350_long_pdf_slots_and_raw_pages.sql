ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "raw_pages" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD COLUMN "slots" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD COLUMN "pages" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD CONSTRAINT "article_revisions_raw_pages" CHECK ("spideryarn"."article_revisions"."raw_pages" is null or "spideryarn"."article_revisions"."raw_pages" > 0);--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_slots" CHECK ("spideryarn"."ingest_events"."slots" between 1 and 8);--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_pages" CHECK ("spideryarn"."ingest_events"."pages" is null or "spideryarn"."ingest_events"."pages" > 0);