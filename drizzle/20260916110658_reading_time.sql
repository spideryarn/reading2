-- Reading time: how long the reader has spent on each block, a running total
-- of seconds — stage 1 of
-- docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md.
--
-- One new table, additive. Keyed by a composite foreign key to
-- `block_identities`, so an id the article never had cannot be stored and the
-- time survives a re-extraction (identity rows are never deleted); deleting the
-- article cascades through that table to this one. No `owner_id` (ownership is
-- inherited through the article) and no timestamps (a total, not a history).
CREATE TABLE "spideryarn"."reading_time" (
	"article_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"seconds" double precision NOT NULL,
	CONSTRAINT "reading_time_article_id_block_id_pk" PRIMARY KEY("article_id","block_id"),
	CONSTRAINT "reading_time_block_id_format" CHECK ("spideryarn"."reading_time"."block_id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "reading_time_seconds" CHECK ("spideryarn"."reading_time"."seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."reading_time" ADD CONSTRAINT "reading_time_block_fk" FOREIGN KEY ("article_id","block_id") REFERENCES "spideryarn"."block_identities"("article_id","block_id") ON DELETE cascade ON UPDATE no action;