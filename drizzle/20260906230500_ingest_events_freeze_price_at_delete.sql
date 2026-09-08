-- Deleting an article must not change what its owner is charged.
--
-- A currently-public article costs half a quota slot and a private one a full
-- one, and usage is recomputed LIVE from `articles.visibility` on every read
-- (docs/project/billing.md § A public article counts half). `ingest_events`
-- reaches the article through `article_id`, which is ON DELETE SET NULL — so
-- destroying a public article turned every one of its charged rows back into an
-- unresolvable row, and an unresolvable row is charged full price. The owner's
-- usage went UP because they threw something away.
--
-- WHY THE PRICE FREEZES AT DELETION AND NOT AT CHARGE. Stamping the price when
-- the ingest settles is the design billing.md rejects in as many words --
-- "charging half at add time misses the article you decide to share three weeks
-- later, which is most of them" -- and it misprices in both directions: private
-- then shared stays full, public then unshared stays half. So the live column
-- goes on winning for as long as there is one, and the frozen value only ever
-- answers once there is not. That also makes it not a second source of truth:
-- the two columns are never both readable. GPT Sol's F2, 2026-09-06,
-- docs/plans/260906h-delete-an-article-permanently.md § Stage B.
--
-- The reading half of this is `isPublicPrice` in src/store/pg-billing.ts:
--   coalesce(a.visibility, e.article_visibility_at_delete, 'private') = 'public'
-- used by the quota wall and by the admin page's half-price split.

ALTER TABLE "spideryarn"."ingest_events" ADD COLUMN "article_visibility_at_delete" text;--> statement-breakpoint

-- Null for every existing row and for every row whose article still exists.
-- Otherwise one of the two visibilities the live column allows -- the same check
-- `articles_visibility` puts on that one, because the coalesce above reads them
-- as one value and a third spelling would be neither branch of `= 'public'`.
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_visibility_at_delete" CHECK ("spideryarn"."ingest_events"."article_visibility_at_delete" is null
          or "spideryarn"."ingest_events"."article_visibility_at_delete" in ('private','public'));--> statement-breakpoint

-- A TRIGGER RATHER THAN APPLICATION CODE, and that is the point of it.
--
-- There is no delete path in the product yet; this lands before the one Stage C
-- builds. Putting the stamp in that store method would make the ledger correct
-- for exactly the route somebody remembered -- and wrong for a future admin
-- path, for a cascade nobody has written, and for the statement an operator runs
-- by hand at three in the morning. The ledger is not where you want to find that
-- out, because nothing about a wrongly-priced row looks wrong.
--
-- BEFORE DELETE, so `article_id` is still set when this runs: the SET NULL that
-- the foreign key performs happens after the row goes. FOR EACH ROW, because the
-- value being frozen is the deleted row's own visibility.
--
-- `SET search_path = ''` and every name schema-qualified, the same shape as
-- `queue_state_is_permanent` in 0001 -- a function's search path is the caller's
-- unless it says otherwise.
CREATE OR REPLACE FUNCTION "spideryarn"."ingest_events_freeze_article_price"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE "spideryarn"."ingest_events"
     SET "article_visibility_at_delete" = OLD."visibility"
   WHERE "article_id" = OLD."id";
  RETURN OLD;
END;
$$;--> statement-breakpoint

-- `DROP ... IF EXISTS` first rather than `CREATE OR REPLACE TRIGGER`, which
-- Postgres only learned in 14 and which says nothing useful here anyway.
DROP TRIGGER IF EXISTS "ingest_events_freeze_article_price" ON "spideryarn"."articles";--> statement-breakpoint

CREATE TRIGGER "ingest_events_freeze_article_price"
  BEFORE DELETE ON "spideryarn"."articles"
  FOR EACH ROW EXECUTE FUNCTION "spideryarn"."ingest_events_freeze_article_price"();--> statement-breakpoint

-- THE DRIFT THIS CREATES, in the same terms 0001 states it: drizzle's snapshot
-- knows about the column and the CHECK above and knows nothing about the
-- function or the trigger. A future generated migration that dropped and
-- recreated `articles` would take the trigger with it and say nothing. The guard
-- is tests/db-schema.test.ts, which deletes an article and asserts the stamp
-- appears -- do not delete that case for looking like a test of Postgres.

-- No backfill, and there is nothing to backfill: every row that predates this
-- either still has its article or lost it before there was anywhere to record
-- what it had been. Those keep reading as `'private'` through the final
-- `coalesce` -- full price, the direction that cannot be gamed.
