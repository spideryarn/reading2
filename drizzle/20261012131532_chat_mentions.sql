-- Chat @-mentions (plan docs/plans/261012d-chat-at-mention-your-own-articles.md § 2):
-- one row per article a question brought into its conversation. Additive: a
-- new table, cascading from the question it came with, and SET NULL on the
-- mentioned article so a deleted one leaves its title behind. Generated.
CREATE TABLE "spideryarn"."chat_mentions" (
	"article_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"message_id" text NOT NULL,
	"position" smallint NOT NULL,
	"mentioned_article_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_mentions_article_id_thread_id_message_id_position_pk" PRIMARY KEY("article_id","thread_id","message_id","position"),
	CONSTRAINT "chat_mentions_position" CHECK ("spideryarn"."chat_mentions"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_mentions" ADD CONSTRAINT "chat_mentions_mentioned_article_id_articles_id_fk" FOREIGN KEY ("mentioned_article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_mentions" ADD CONSTRAINT "chat_mentions_message_fk" FOREIGN KEY ("article_id","thread_id","message_id") REFERENCES "spideryarn"."chat_messages"("article_id","thread_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_mentions_mentioned_idx" ON "spideryarn"."chat_mentions" USING btree ("mentioned_article_id");