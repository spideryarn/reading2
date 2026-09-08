-- The three P2s GPT Sol raised against Stage B, in one migration.
--
-- Stage B (drizzle/20260906230500_ingest_events_freeze_price_at_delete.sql)
-- froze an article's price onto its charged ledger rows at the moment it is
-- deleted, so that destroying a public article cannot raise its owner's bill.
-- Sol passed it and found three things that are each one step away from being a
-- wrong bill or an outage:
--
--   F7  deleting an article scans the whole ledger, twice
--   F9  "the two columns are never both readable" was a comment, not a rule
--   F8  a stray `set article_id = null` still loses the price in silence
--
-- The review is docs/plans/260906h-delete-an-article-permanently-stage-b-review-sol.md.
-- All three are guarded by tests/db-schema.test.ts, which is the only thing
-- watching the triggers: drizzle's snapshot records the index and the CHECK and
-- knows nothing at all about a trigger or a function.

-- ---------------------------------------------------------------- F7 -------
-- POSTGRES DOES NOT INDEX THE REFERENCING SIDE OF A FOREIGN KEY, and deleting
-- an article reads exactly this column: the freeze trigger's
-- `update ... where article_id = OLD.id`. `ingest_events` is an append-only
-- ledger that only grows, so without this every deletion is a sequential scan
-- of all of it, and a bulk delete is one scan per article. The way that finally
-- announces itself is a delete exceeding the runtime role's two-minute
-- statement timeout — a symptom nobody would trace back to a missing index.
--
-- PARTIAL, because a row with no article can never match `article_id = <uuid>`,
-- and those are the rows that accumulate for ever: every reservation that was
-- released, every row charged before the column existed, and every row whose
-- article has since been deleted.
CREATE INDEX "ingest_events_article_id_live" ON "spideryarn"."ingest_events" USING btree ("article_id") WHERE "spideryarn"."ingest_events"."article_id" is not null;--> statement-breakpoint

-- ---------------------------------------------------------------- F9 -------
-- UNLINK AND STAMP IN ONE STATEMENT, so that "never both readable" can become a
-- constraint.
--
-- The frozen price is a *second* answer to what an ingest cost, and the only
-- thing that makes a second answer safe is that it is unreadable while the
-- first one exists — that is the whole of F2's argument in Stage B. Stage B
-- stamped the price and left `article_id` to the foreign key's
-- `on delete set null`, which runs afterwards; the state where both columns are
-- set was therefore reachable, and an ordinary `UPDATE` could reach it and
-- stay there. No wrong bill today, because `isPublicPrice`
-- (src/store/pg-billing.ts) reads the live column first — a trap for whoever
-- reorders that `coalesce`.
--
-- Doing both in one statement is what makes the CHECK below satisfiable: a
-- CHECK is evaluated per row as the row is written, so a row that is unlinked
-- and stamped by the same `UPDATE` is never momentarily in the forbidden state.
-- Stamping first and unlinking second would put every deletion into it.
--
-- The foreign key's `on delete set null` stays exactly as it was and is now a
-- backstop that finds nothing: by the time it runs, this trigger has already
-- taken the rows. If this trigger ever drifts away, the FK still unlinks and
-- the F8 guard below turns that into a loud failure instead of a quiet
-- mispricing.
CREATE OR REPLACE FUNCTION "spideryarn"."ingest_events_freeze_article_price"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE "spideryarn"."ingest_events"
     SET "article_visibility_at_delete" = OLD."visibility",
         "article_id" = NULL
   WHERE "article_id" = OLD."id";
  RETURN OLD;
END;
$$;--> statement-breakpoint

-- The rule the comments have been claiming since Stage B. Validated rather than
-- `NOT VALID`: no supported path has ever been able to leave a row in this
-- state — the trigger stamps only rows whose article is being destroyed, and
-- the FK nulls those rows in the same transaction — so a failure here would be
-- real news about the data, and finding that out during the migration is the
-- point of not deferring it.
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_frozen_only_after_unlink" CHECK ("spideryarn"."ingest_events"."article_id" is null or "spideryarn"."ingest_events"."article_visibility_at_delete" is null);--> statement-breakpoint

-- ---------------------------------------------------------------- F8 -------
-- LOSING THE ARTICLE WITHOUT RECORDING WHAT IT WAS MUST FAIL LOUDLY.
--
-- Nothing in the product writes `update ingest_events set article_id = null`,
-- and that is precisely why it is worth guarding: it is the one write that
-- turns a half-price public charge into a full-price unresolvable one, and
-- nothing about the resulting row looks wrong afterwards. An operator clearing
-- up by hand, a future cascade, or this file's own freeze trigger having been
-- dropped by a regenerated migration all arrive at the same row.
--
-- `BEFORE UPDATE OF article_id`, so it costs nothing on the writes that do not
-- touch the column — chiefly `settleReservation`, which sets `article_id` from
-- null to non-null and is not this transition. The legitimate unlink is not
-- refused either: it carries the frozen price in the same statement, so
-- `NEW.article_visibility_at_delete` is already set when this runs.
--
-- `23514`, the same SQLSTATE a CHECK violation raises, because that is what
-- this is — a constraint that a CHECK cannot express, since it is about a
-- transition rather than a row.
--
-- `SET search_path = ''` and every name schema-qualified, the same shape as
-- `queue_state_is_permanent` in 0001: a function's search path is the caller's
-- unless it says otherwise.
CREATE OR REPLACE FUNCTION "spideryarn"."ingest_events_require_price_on_unlink"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD."article_id" IS NOT NULL
     AND NEW."article_id" IS NULL
     AND NEW."article_visibility_at_delete" IS NULL THEN
    RAISE EXCEPTION
      'ingest event % cannot lose article_id without a frozen price', OLD."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- `DROP ... IF EXISTS` first rather than `CREATE OR REPLACE TRIGGER`, which
-- Postgres only learned in 14 — the same choice Stage B made.
DROP TRIGGER IF EXISTS "ingest_events_require_price_on_unlink" ON "spideryarn"."ingest_events";--> statement-breakpoint

CREATE TRIGGER "ingest_events_require_price_on_unlink"
  BEFORE UPDATE OF "article_id" ON "spideryarn"."ingest_events"
  FOR EACH ROW EXECUTE FUNCTION "spideryarn"."ingest_events_require_price_on_unlink"();

-- WHAT DRIZZLE GENERATED AND WAS TAKEN OUT: a `DROP`/`ADD` of
-- `revision_step_runs_step`, identical in both directions to the one
-- drizzle/20260906190000_labels_step.sql already applied. It appeared because
-- Stage B's snapshot was re-stamped by hand after a merge from a base that
-- predated `'labels'`, so the snapshot had lost a step name the database has.
-- The snapshot beside this migration carries the correct list again, which is
-- the repair; re-running the DDL would only have been a second full validation
-- scan of a table this migration has nothing to do with.
