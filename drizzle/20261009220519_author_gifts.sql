CREATE TABLE "spideryarn"."author_gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"voucher_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"starter_slug" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text,
	"recipient_name" text,
	"recipient_note" text,
	"articles" integer DEFAULT 20 NOT NULL,
	"notes" text,
	"notes_updated_at" timestamp with time zone,
	"email_lookup_id" uuid,
	"name_lookup_id" uuid,
	"send_started_at" timestamp with time zone,
	"send_attempt" uuid,
	"discarded_at" timestamp with time zone,
	CONSTRAINT "author_gifts_email_normalised" CHECK ("spideryarn"."author_gifts"."email" is null or ("spideryarn"."author_gifts"."email" = lower(btrim("spideryarn"."author_gifts"."email")) and "spideryarn"."author_gifts"."email" like '%_@_%')),
	CONSTRAINT "author_gifts_articles_range" CHECK ("spideryarn"."author_gifts"."articles" between 1 and 1000),
	CONSTRAINT "author_gifts_notes_length" CHECK ("spideryarn"."author_gifts"."notes" is null or char_length("spideryarn"."author_gifts"."notes") <= 1000000),
	CONSTRAINT "author_gifts_recipient_note_length" CHECK ("spideryarn"."author_gifts"."recipient_note" is null or char_length("spideryarn"."author_gifts"."recipient_note") <= 1000000),
	CONSTRAINT "author_gifts_recipient_name_length" CHECK ("spideryarn"."author_gifts"."recipient_name" is null or char_length("spideryarn"."author_gifts"."recipient_name") <= 10000),
	CONSTRAINT "author_gifts_starter_slug_length" CHECK (char_length("spideryarn"."author_gifts"."starter_slug") <= 10000),
	CONSTRAINT "author_gifts_send_has_email" CHECK ("spideryarn"."author_gifts"."send_started_at" is null or "spideryarn"."author_gifts"."email" is not null),
	CONSTRAINT "author_gifts_send_not_discarded" CHECK ("spideryarn"."author_gifts"."send_started_at" is null or "spideryarn"."author_gifts"."discarded_at" is null),
	CONSTRAINT "author_gifts_send_attempt_together" CHECK (num_nonnulls("spideryarn"."author_gifts"."send_started_at", "spideryarn"."author_gifts"."send_attempt") <> 1)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."author_lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_gift_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"failure" text,
	"author_name" text,
	"author_source_url" text,
	"email" text,
	"email_source_url" text,
	"suggested_email" text,
	"contact_url" text,
	"searches" integer,
	"run_id" uuid,
	"model" text,
	CONSTRAINT "author_lookups_outcome" CHECK ("spideryarn"."author_lookups"."outcome" is null or "spideryarn"."author_lookups"."outcome" in ('address', 'author', 'nothing', 'failed')),
	CONSTRAINT "author_lookups_finished_together" CHECK (("spideryarn"."author_lookups"."finished_at" is null) = ("spideryarn"."author_lookups"."outcome" is null)),
	CONSTRAINT "author_lookups_failure_only_failed" CHECK ("spideryarn"."author_lookups"."failure" is null or "spideryarn"."author_lookups"."outcome" = 'failed'),
	CONSTRAINT "author_lookups_searches" CHECK ("spideryarn"."author_lookups"."searches" is null or "spideryarn"."author_lookups"."searches" >= 0),
	CONSTRAINT "author_lookups_text_lengths" CHECK (coalesce(char_length("spideryarn"."author_lookups"."failure"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."author_name"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."author_source_url"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."email"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."email_source_url"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."suggested_email"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."contact_url"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."model"), 0) <= 10000)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."author_gifts" ADD CONSTRAINT "author_gifts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."author_gifts" ADD CONSTRAINT "author_gifts_email_lookup_id_author_lookups_id_fk" FOREIGN KEY ("email_lookup_id") REFERENCES "spideryarn"."author_lookups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."author_gifts" ADD CONSTRAINT "author_gifts_name_lookup_id_author_lookups_id_fk" FOREIGN KEY ("name_lookup_id") REFERENCES "spideryarn"."author_lookups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."author_lookups" ADD CONSTRAINT "author_lookups_author_gift_id_author_gifts_id_fk" FOREIGN KEY ("author_gift_id") REFERENCES "spideryarn"."author_gifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "author_gifts_article" ON "spideryarn"."author_gifts" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "author_gifts_voucher" ON "spideryarn"."author_gifts" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "author_lookups_gift" ON "spideryarn"."author_lookups" USING btree ("author_gift_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "author_lookups_one_pending" ON "spideryarn"."author_lookups" USING btree ("author_gift_id") WHERE "spideryarn"."author_lookups"."outcome" is null;