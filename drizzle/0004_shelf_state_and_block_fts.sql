ALTER TABLE "spideryarn"."articles" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD COLUMN "title_override" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD COLUMN "opens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD COLUMN "last_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_blocks" ADD COLUMN "fts" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce("spideryarn"."revision_blocks"."text", ''))) STORED;--> statement-breakpoint
CREATE INDEX "revision_blocks_fts" ON "spideryarn"."revision_blocks" USING gin ("fts");