CREATE TABLE "spideryarn"."article_share_link_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid,
	"slug" text NOT NULL,
	"actor_owner_id" uuid NOT NULL,
	"event" text NOT NULL,
	"rights_confirmed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_share_link_events_event" CHECK ("spideryarn"."article_share_link_events"."event" in ('created','turned-off')),
	CONSTRAINT "article_share_link_events_rights" CHECK (("spideryarn"."article_share_link_events"."event" = 'created') = "spideryarn"."article_share_link_events"."rights_confirmed")
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD COLUMN "share_token_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_share_link_events" ADD CONSTRAINT "article_share_link_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_share_link_events_article_at" ON "spideryarn"."article_share_link_events" USING btree ("article_id","created_at");--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD CONSTRAINT "articles_share_token_unique" UNIQUE("share_token");--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD CONSTRAINT "articles_share_token_shape" CHECK ("spideryarn"."articles"."share_token" is null or "spideryarn"."articles"."share_token" ~ '^[A-Za-z0-9_-]{22}$');--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD CONSTRAINT "articles_share_token_pair" CHECK (("spideryarn"."articles"."share_token" is null) = ("spideryarn"."articles"."share_token_at" is null));