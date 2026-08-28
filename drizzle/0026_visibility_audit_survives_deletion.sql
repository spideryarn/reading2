-- Let the visibility log outlive the article it is about.
--
-- 0024 gave `article_visibility_changes.article_id` the `on delete cascade`
-- every other child of `articles` has, on the reasoning that a log row naming an
-- article nobody holds any more answers nothing anybody would ask. GPT Sol's
-- review put it the other way round the same day, and it is right: the log
-- exists for the complaint that arrives **after** a document is taken down, so
-- cascade erased the record at exactly the moment somebody needed it.
--
-- The 0024 comment also rested on a claim that was false — "nothing deletes an
-- article today". `src/store/import.ts` deletes orphaned articles. So this was a
-- live loss rather than a choice about a path that did not exist yet.
--
-- Everything that makes the row evidence survives without the reference: the
-- slug that was shared, who shared it, the transition, whether they confirmed
-- the right to share, and when. `slug` stays `not null` for that reason — a row
-- with neither an article nor a slug is not evidence of anything.
--
-- The foreign key is kept rather than dropped, so a row that *does* point at an
-- article still cannot point at a missing one. Null now means one specific
-- thing: the article has been deleted.
--
-- Additive in effect: no rows change, no data is lost, and the column only
-- becomes more permissive.
ALTER TABLE "spideryarn"."article_visibility_changes" DROP CONSTRAINT "article_visibility_changes_article_id_articles_id_fk";
--> statement-breakpoint
ALTER TABLE "spideryarn"."article_visibility_changes" ALTER COLUMN "article_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_visibility_changes" ADD CONSTRAINT "article_visibility_changes_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE set null ON UPDATE no action;