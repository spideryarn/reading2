-- The glossary entries an owner has hidden from their own view of one article —
-- stage 2 of
-- docs/plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md.
--
-- One new table, additive. Keyed on (article, entry id); the entry id carries
-- the spya id format check. Deleting the article cascades. No `owner_id`
-- (ownership is inherited through the article) and no timestamps.
CREATE TABLE "spideryarn"."glossary_hidden_entries" (
	"article_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	CONSTRAINT "glossary_hidden_entries_article_id_entry_id_pk" PRIMARY KEY("article_id","entry_id"),
	CONSTRAINT "glossary_hidden_entries_entry_id_format" CHECK ("spideryarn"."glossary_hidden_entries"."entry_id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_hidden_entries" ADD CONSTRAINT "glossary_hidden_entries_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;