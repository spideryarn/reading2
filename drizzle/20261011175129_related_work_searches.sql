-- Sources › Not cited (plan 261011ac): the owner's last OpenAlex search for
-- related work, one row per article, and its own allowance bucket
-- (`related-work-search`, src/related-work.ts § RELATED_WORK_RATE_POLICY).
-- Additive: a new table, and one more word the bucket CHECK admits. Generated.
CREATE TABLE "spideryarn"."related_work_searches" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"year_limit" integer,
	"results" jsonb NOT NULL,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "related_work_searches_fingerprint" CHECK ("spideryarn"."related_work_searches"."fingerprint" ~ '^related-work/[0-9]+:[0-9a-f]{64}$'),
	CONSTRAINT "related_work_searches_year_limit" CHECK ("spideryarn"."related_work_searches"."year_limit" is null or "spideryarn"."related_work_searches"."year_limit" between 1500 and 2100),
	CONSTRAINT "related_work_searches_results" CHECK (jsonb_typeof("spideryarn"."related_work_searches"."results") = 'array')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."related_work_searches" ADD CONSTRAINT "related_work_searches_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics', 'upload-source-guess', 'citation-investigate', 'dig-deeper', 'feedback-notice', 'help-chat', 'debate-check', 'sources-claim-check', 'related-work-search'));