-- Hidden text's Opus check gets a home: the last finished answer, one per article.
-- docs/plans/261009a-save-hidden-text-opinions.md; the column comments are in src/db/schema.ts.
-- Additive: a new table, nothing existing touched. The owner key is by hand, as in
-- drizzle/0051_referee_claims.sql, ON DELETE RESTRICT like every other owner key.

CREATE TABLE "spideryarn"."referee_hidden_checks" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"judgments" jsonb NOT NULL,
	"unanswered" integer NOT NULL,
	"not_sent" integer NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	CONSTRAINT "referee_hidden_checks_counts" CHECK ("spideryarn"."referee_hidden_checks"."unanswered" >= 0 and "spideryarn"."referee_hidden_checks"."not_sent" >= 0 and "spideryarn"."referee_hidden_checks"."not_sent" <= "spideryarn"."referee_hidden_checks"."unanswered"),
	CONSTRAINT "referee_hidden_checks_judgments_array" CHECK (jsonb_typeof("spideryarn"."referee_hidden_checks"."judgments") = 'array')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_hidden_checks" ADD CONSTRAINT "referee_hidden_checks_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_hidden_checks" ADD CONSTRAINT "referee_hidden_checks_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
