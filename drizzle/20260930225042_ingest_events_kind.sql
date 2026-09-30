ALTER TABLE "spideryarn"."ingest_events" ADD COLUMN "kind" text DEFAULT 'ingest' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_events_high_power_once" ON "spideryarn"."ingest_events" USING btree ("article_id") WHERE "spideryarn"."ingest_events"."kind" = 'high_power' and "spideryarn"."ingest_events"."article_id" is not null;--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_kind" CHECK ("spideryarn"."ingest_events"."kind" in ('ingest','high_power'));--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events" ADD CONSTRAINT "ingest_events_high_power_shape" CHECK ("spideryarn"."ingest_events"."kind" <> 'high_power'
          or ("spideryarn"."ingest_events"."succeeded_at" is not null
              and "spideryarn"."ingest_events"."released_at" is null
              and "spideryarn"."ingest_events"."reserved_at" = "spideryarn"."ingest_events"."succeeded_at"
              and ("spideryarn"."ingest_events"."article_id" is not null or "spideryarn"."ingest_events"."article_visibility_at_delete" is not null)));