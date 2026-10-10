CREATE TABLE "spideryarn"."stale_notice_dismissals" (
	"article_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"dismissed_for" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stale_notice_dismissals_article_id_mode_pk" PRIMARY KEY("article_id","mode"),
	CONSTRAINT "stale_notice_dismissals_mode" CHECK ("spideryarn"."stale_notice_dismissals"."mode" in ('glossary', 'ideas', 'faq', 'timeline', 'simple', 'citations', 'tweets', 'debate', 'debate-claims', 'quotes', 'skim', 'search', 'sketch', 'illustrated', 'claims')),
	CONSTRAINT "stale_notice_dismissals_dismissed_for" CHECK (cardinality("spideryarn"."stale_notice_dismissals"."dismissed_for") between 1 and 50 and array_ndims("spideryarn"."stale_notice_dismissals"."dismissed_for") = 1 and array_position("spideryarn"."stale_notice_dismissals"."dismissed_for", null) is null and array_to_string("spideryarn"."stale_notice_dismissals"."dismissed_for", '') ~ '^[!-~]+$' and array_to_string("spideryarn"."stale_notice_dismissals"."dismissed_for", chr(10)) ~ '^[!-~]{1,120}(\n[!-~]{1,120})*$')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."stale_notice_dismissals" ADD CONSTRAINT "stale_notice_dismissals_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;
