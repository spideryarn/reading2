CREATE TABLE "spideryarn"."article_tags" (
	"article_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_tags_article_id_tag_pk" PRIMARY KEY("article_id","tag"),
	CONSTRAINT "article_tags_spelling" CHECK (char_length("spideryarn"."article_tags"."tag") between 1 and 40 and "spideryarn"."article_tags"."tag" = btrim("spideryarn"."article_tags"."tag") and "spideryarn"."article_tags"."tag" = lower("spideryarn"."article_tags"."tag") and "spideryarn"."article_tags"."tag" !~ '[,[:cntrl:]]' and "spideryarn"."article_tags"."tag" !~ '\s\s')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."article_tags" ADD CONSTRAINT "article_tags_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;