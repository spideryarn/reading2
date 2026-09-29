-- An uploaded paper's guessed web address — stage 2 of
-- docs/plans/260929g-canonical-link-for-an-uploaded-paper.md. Additive: one new
-- table (a claim and its answer, one row per article, cascading with it) and a
-- fifth rate-limit bucket, `upload-source-guess`, for the web search it pays for.
-- src/db/schema.ts § uploadSourceGuesses says what each CHECK holds.
CREATE TABLE "spideryarn"."upload_source_guesses" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"url" text,
	"host" text,
	"kind" text,
	"matched_by" text,
	"why" text,
	"claim_token" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"searches" integer,
	"model" text,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "upload_source_guesses_status" CHECK ("spideryarn"."upload_source_guesses"."status" in ('searching', 'found', 'none')),
	CONSTRAINT "upload_source_guesses_kind" CHECK ("spideryarn"."upload_source_guesses"."kind" is null or "spideryarn"."upload_source_guesses"."kind" in ('canonical', 'matching')),
	CONSTRAINT "upload_source_guesses_matched_by" CHECK ("spideryarn"."upload_source_guesses"."matched_by" is null or "spideryarn"."upload_source_guesses"."matched_by" in ('doi', 'arxiv', 'content')),
	CONSTRAINT "upload_source_guesses_kind_matches" CHECK ("spideryarn"."upload_source_guesses"."kind" is null or ("spideryarn"."upload_source_guesses"."kind" = 'canonical') = ("spideryarn"."upload_source_guesses"."matched_by" in ('doi', 'arxiv'))),
	CONSTRAINT "upload_source_guesses_url_scheme" CHECK ("spideryarn"."upload_source_guesses"."url" is null or "spideryarn"."upload_source_guesses"."url" ~ '^https?://'),
	CONSTRAINT "upload_source_guesses_attempts" CHECK ("spideryarn"."upload_source_guesses"."attempts" between 0 and 2),
	CONSTRAINT "upload_source_guesses_searches" CHECK ("spideryarn"."upload_source_guesses"."searches" is null or "spideryarn"."upload_source_guesses"."searches" >= 0),
	CONSTRAINT "upload_source_guesses_searching" CHECK ("spideryarn"."upload_source_guesses"."status" <> 'searching' or ("spideryarn"."upload_source_guesses"."claim_token" is not null and "spideryarn"."upload_source_guesses"."claimed_at" is not null
        and "spideryarn"."upload_source_guesses"."finished_at" is null and "spideryarn"."upload_source_guesses"."url" is null and "spideryarn"."upload_source_guesses"."host" is null and "spideryarn"."upload_source_guesses"."kind" is null
        and "spideryarn"."upload_source_guesses"."matched_by" is null and "spideryarn"."upload_source_guesses"."why" is null)),
	CONSTRAINT "upload_source_guesses_found" CHECK ("spideryarn"."upload_source_guesses"."status" <> 'found' or ("spideryarn"."upload_source_guesses"."url" is not null and "spideryarn"."upload_source_guesses"."host" is not null and "spideryarn"."upload_source_guesses"."kind" is not null
        and "spideryarn"."upload_source_guesses"."matched_by" is not null and "spideryarn"."upload_source_guesses"."why" is null and "spideryarn"."upload_source_guesses"."claim_token" is null
        and "spideryarn"."upload_source_guesses"."finished_at" is not null)),
	CONSTRAINT "upload_source_guesses_none" CHECK ("spideryarn"."upload_source_guesses"."status" <> 'none' or ("spideryarn"."upload_source_guesses"."why" is not null and "spideryarn"."upload_source_guesses"."url" is null and "spideryarn"."upload_source_guesses"."host" is null
        and "spideryarn"."upload_source_guesses"."kind" is null and "spideryarn"."upload_source_guesses"."matched_by" is null and "spideryarn"."upload_source_guesses"."claim_token" is null
        and "spideryarn"."upload_source_guesses"."finished_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."upload_source_guesses" ADD CONSTRAINT "upload_source_guesses_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics', 'upload-source-guess'));