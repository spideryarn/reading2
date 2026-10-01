-- Idempotent on purpose: this was generated as 20260930225042_ingest_events_kind,
-- applied to the shared local database, then rebuilt on a merge that forked the
-- chain (docs/project/database.md § Repairing a fork). On a database that already
-- has the column, index and checks this changes nothing; elsewhere it is the
-- plain migration. Plan 260930k.
ALTER TABLE "spideryarn"."ingest_events" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'ingest' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingest_events_high_power_once" ON "spideryarn"."ingest_events" USING btree ("article_id") WHERE "spideryarn"."ingest_events"."kind" = 'high_power' and "spideryarn"."ingest_events"."article_id" is not null;--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" DROP CONSTRAINT IF EXISTS "ingest_events_kind";--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_kind" CHECK ("spideryarn"."ingest_events"."kind" in ('ingest','high_power'));--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" DROP CONSTRAINT IF EXISTS "ingest_events_high_power_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_high_power_shape" CHECK ("spideryarn"."ingest_events"."kind" <> 'high_power'
          or ("spideryarn"."ingest_events"."succeeded_at" is not null
              and "spideryarn"."ingest_events"."released_at" is null
              and "spideryarn"."ingest_events"."reserved_at" = "spideryarn"."ingest_events"."succeeded_at"
              and ("spideryarn"."ingest_events"."article_id" is not null or "spideryarn"."ingest_events"."article_visibility_at_delete" is not null)));