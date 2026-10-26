CREATE TABLE "spideryarn"."read_so_far_words" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"basis" text NOT NULL,
	"words" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "read_so_far_words_object" CHECK (jsonb_typeof("spideryarn"."read_so_far_words"."words") = 'object')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."read_so_far_words" ADD CONSTRAINT "read_so_far_words_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;