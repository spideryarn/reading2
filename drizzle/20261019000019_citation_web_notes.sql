CREATE TABLE "spideryarn"."citation_web_notes" (
	"article_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"identity" text NOT NULL,
	"state" text NOT NULL,
	"why" text,
	"sentences" jsonb,
	"url" text,
	"host" text,
	"title" text,
	"read_at" timestamp with time zone,
	"checked_at" timestamp with time zone NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"validation_version" text NOT NULL,
	"searches" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "citation_web_notes_article_id_entry_id_pk" PRIMARY KEY("article_id","entry_id"),
	CONSTRAINT "citation_web_notes_entry_id_format" CHECK ("spideryarn"."citation_web_notes"."entry_id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "citation_web_notes_state" CHECK ("spideryarn"."citation_web_notes"."state" in ('note', 'none')),
	CONSTRAINT "citation_web_notes_why" CHECK (coalesce("spideryarn"."citation_web_notes"."state" = 'none', false) = ("spideryarn"."citation_web_notes"."why" is not null) and ("spideryarn"."citation_web_notes"."why" is null or "spideryarn"."citation_web_notes"."why" in ('no-results', 'none-picked', 'not-a-result', 'not-the-work', 'the-article', 'no-extract', 'declined', 'quote-not-in-evidence', 'quote-too-short', 'quote-too-long', 'too-long', 'not-supported'))),
	CONSTRAINT "citation_web_notes_note" CHECK (coalesce("spideryarn"."citation_web_notes"."state" = 'note', false) = ("spideryarn"."citation_web_notes"."sentences" is not null) and coalesce("spideryarn"."citation_web_notes"."state" = 'note', false) = ("spideryarn"."citation_web_notes"."url" is not null) and coalesce("spideryarn"."citation_web_notes"."state" = 'note', false) = ("spideryarn"."citation_web_notes"."host" is not null) and coalesce("spideryarn"."citation_web_notes"."state" = 'note', false) = ("spideryarn"."citation_web_notes"."read_at" is not null) and ("spideryarn"."citation_web_notes"."title" is null or "spideryarn"."citation_web_notes"."url" is not null)),
	CONSTRAINT "citation_web_notes_sentences" CHECK ("spideryarn"."citation_web_notes"."sentences" is null or (case when jsonb_typeof("spideryarn"."citation_web_notes"."sentences") = 'array' then jsonb_array_length("spideryarn"."citation_web_notes"."sentences") between 1 and 2 else false end)),
	CONSTRAINT "citation_web_notes_url_scheme" CHECK ("spideryarn"."citation_web_notes"."url" is null or "spideryarn"."citation_web_notes"."url" ~ '^https?://'),
	CONSTRAINT "citation_web_notes_searches" CHECK ("spideryarn"."citation_web_notes"."searches" is null or "spideryarn"."citation_web_notes"."searches" >= 0)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_web_notes" ADD CONSTRAINT "citation_web_notes_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics', 'upload-source-guess', 'citation-investigate', 'dig-deeper', 'feedback-notice', 'help-chat', 'debate-check', 'sources-claim-check', 'related-work-search', 'citation-web-note'));