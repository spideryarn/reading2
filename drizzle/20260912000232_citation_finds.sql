-- Citations mode's *Find it on the web* — stage 3 of
-- docs/plans/260911g-citations-mode.md.
--
-- One new table, additive: `glossary_lookups`' shape. Reader state keyed on
-- `(article_id, entry_id)`, apart from the `citations` artefact and attached to
-- each entry at read time, so a page found once survives the list being found
-- again (entry ids are inherited across re-runs by dedupe key). Only a KEPT
-- find is a row; a search that matched nothing writes nothing.
--
-- `url` and `title` are the search result's own — a `url_citation` annotation
-- the call returned — never the model's; src/citation-find.ts § `readFind`.
-- `searches` is nullable because "the provider did not report a count" is not
-- zero. The `auth.users` foreign key on `owner_id` is the next migration, by
-- hand, for the reason src/db/schema.ts's header gives.
CREATE TABLE "spideryarn"."citation_finds" (
	"article_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"host" text NOT NULL,
	"searches" integer,
	"model" text NOT NULL,
	"found_at" timestamp with time zone NOT NULL,
	CONSTRAINT "citation_finds_article_id_entry_id_pk" PRIMARY KEY("article_id","entry_id"),
	CONSTRAINT "citation_finds_entry_id_format" CHECK ("spideryarn"."citation_finds"."entry_id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "citation_finds_searches" CHECK ("spideryarn"."citation_finds"."searches" is null or "spideryarn"."citation_finds"."searches" >= 0),
	CONSTRAINT "citation_finds_url_scheme" CHECK ("spideryarn"."citation_finds"."url" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_finds" ADD CONSTRAINT "citation_finds_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;