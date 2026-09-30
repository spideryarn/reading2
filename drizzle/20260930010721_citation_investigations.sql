-- Citations mode's *Investigate* — docs/plans/260930a-citations-investigate-one-work-on-demand.md.
--
-- Additive: one new table, `citation_finds`' shape (reader state keyed on
-- `(article_id, entry_id)`, attached at read time while `context_hash` matches),
-- and a widened CHECK on `rate_limit_events.bucket` for the new
-- `citation-investigate` allowance. Every existing row satisfies the wider set.
-- The `auth.users` FK on `owner_id` is the next migration, by hand.
CREATE TABLE "spideryarn"."citation_investigations" (
	"article_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extracts_read" integer NOT NULL,
	"longest_extract_words" integer NOT NULL,
	"matched_host" text,
	"searches" integer,
	"searches_from" text NOT NULL,
	"model" text NOT NULL,
	"context_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "citation_investigations_article_id_entry_id_pk" PRIMARY KEY("article_id","entry_id"),
	CONSTRAINT "citation_investigations_entry_id_format" CHECK ("spideryarn"."citation_investigations"."entry_id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "citation_investigations_counts" CHECK ("spideryarn"."citation_investigations"."extracts_read" >= 1 and "spideryarn"."citation_investigations"."longest_extract_words" >= 0 and ("spideryarn"."citation_investigations"."searches" is null or "spideryarn"."citation_investigations"."searches" >= 0)),
	CONSTRAINT "citation_investigations_answer" CHECK (char_length("spideryarn"."citation_investigations"."answer") > 0)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_investigations" ADD CONSTRAINT "citation_investigations_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics', 'upload-source-guess', 'citation-investigate'));