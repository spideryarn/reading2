-- Your place in an article, on the server: the paragraph the owner last read
-- in each of their articles, so another device can open there —
-- docs/plans/261029f-your-place-in-an-article-follows-you-to-another-device.md
-- (Greg's reply spya-hfufq8 to q-mpq9dp, report spya-e23tee).
--
-- One new table, additive, nothing backfilled. One row per article; a null
-- `block_id` is "opened, at the top". The composite key to `block_identities`
-- is reading_time's, and a null block skips it (MATCH SIMPLE), so the article
-- has its own key too; deleting the article cascades. No `owner_id`, as with
-- reading_time: a transfer deletes the row (src/store/pg-article-transfer.ts).
CREATE TABLE "spideryarn"."reading_place" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"block_id" text,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_place_block_id_format" CHECK ("spideryarn"."reading_place"."block_id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."reading_place" ADD CONSTRAINT "reading_place_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."reading_place" ADD CONSTRAINT "reading_place_block_fk" FOREIGN KEY ("article_id","block_id") REFERENCES "spideryarn"."block_identities"("article_id","block_id") ON DELETE cascade ON UPDATE no action;