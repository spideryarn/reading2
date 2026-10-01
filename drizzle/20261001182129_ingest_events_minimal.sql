-- A minimal paper costs a hundredth of an ingest, and Read this costs the rest.
-- Plan docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md,
-- Stage 2; the billing is docs/project/billing.md § A minimal paper costs a
-- hundredth. Additive: no stored row changes.
--
--   kind 'minimal'                       a paper added with only its metadata read
--   superseded_by -> ingest_events(id)   the ingest that paid for it in full
--   ingest_events_superseded_shape       only a charged minimal row is superseded
--   ingest_events_one_upgrade_in_flight  one Read this reservation per article
--   ingest_events_superseded_by_ingest   the trigger: what it points at is a
--                                        charged ingest of the same paper
--
-- The kind check is dropped and re-added, as
-- drizzle/20261001004017_ingest_events_kind.sql did it. The unique index is
-- safe over today's rows: an ordinary ingest reservation has no article_id
-- until the statement that settles it, so no unsettled ingest row has one.
ALTER TABLE "spideryarn"."ingest_events" DROP CONSTRAINT "ingest_events_kind";--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_superseded_by_ingest_events_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "spideryarn"."ingest_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_events_one_upgrade_in_flight" ON "spideryarn"."ingest_events" USING btree ("article_id") WHERE "spideryarn"."ingest_events"."kind" = 'ingest' and "spideryarn"."ingest_events"."article_id" is not null
            and "spideryarn"."ingest_events"."succeeded_at" is null and "spideryarn"."ingest_events"."released_at" is null;--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_superseded_shape" CHECK ("spideryarn"."ingest_events"."superseded_by" is null
          or ("spideryarn"."ingest_events"."kind" = 'minimal' and "spideryarn"."ingest_events"."succeeded_at" is not null));--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_kind" CHECK ("spideryarn"."ingest_events"."kind" in ('ingest','high_power','minimal'));--> statement-breakpoint

-- WHAT A CHECK CANNOT SAY: the row `superseded_by` points at is a charged
-- `'ingest'` of the same owner and the same article. A CHECK sees one row, so
-- this is a trigger, in the shape of `ingest_events_require_price_on_unlink`
-- (drizzle/20260907200800_ingest_events_unlink_atomically.sql): `SET
-- search_path = ''`, every name qualified, and SQLSTATE 23514 because it is a
-- constraint.
--
-- "The same article" requires equal, non-null `article_id`s. Both null is what
-- the delete trigger leaves behind, and it proves nothing: rows from two
-- different deleted papers are both null. A new supersession after unlink is
-- therefore refused. Deleting an already-superseded paper remains valid: the
-- delete trigger updates `article_id`, not `superseded_by`, so this trigger does
-- not fire and the existing stamp survives.
--
-- `FOR SHARE` on the referenced row, so a concurrent writer cannot change it
-- between this check and the commit. No application path later changes a
-- terminal settlement or deletes from this ledger.
--
-- drizzle's snapshot knows nothing about a trigger; tests/db-schema.test.ts is
-- what watches it.
CREATE OR REPLACE FUNCTION "spideryarn"."ingest_events_superseded_by_ingest"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  payer RECORD;
BEGIN
  IF NEW."superseded_by" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."article_id" IS NULL THEN
    RAISE EXCEPTION
      'ingest event % cannot be superseded after its article was deleted', NEW."id"
      USING ERRCODE = '23514';
  END IF;
  SELECT "kind", "owner_id", "article_id", "succeeded_at"
    INTO payer
    FROM "spideryarn"."ingest_events"
   WHERE "id" = NEW."superseded_by"
   FOR SHARE;
  IF NOT FOUND
     OR payer."kind" <> 'ingest'
     OR payer."succeeded_at" IS NULL
     OR payer."owner_id" <> NEW."owner_id"
     OR payer."article_id" IS DISTINCT FROM NEW."article_id" THEN
    RAISE EXCEPTION
      'ingest event % can only be superseded by a charged ingest of the same owner and article', NEW."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- `DROP ... IF EXISTS` first rather than `CREATE OR REPLACE TRIGGER`, the
-- choice the two earlier ledger triggers made.
DROP TRIGGER IF EXISTS "ingest_events_superseded_by_ingest" ON "spideryarn"."ingest_events";--> statement-breakpoint

CREATE TRIGGER "ingest_events_superseded_by_ingest"
  BEFORE INSERT OR UPDATE OF "superseded_by" ON "spideryarn"."ingest_events"
  FOR EACH ROW EXECUTE FUNCTION "spideryarn"."ingest_events_superseded_by_ingest"();
