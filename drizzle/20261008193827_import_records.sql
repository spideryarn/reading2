CREATE TABLE "spideryarn"."import_records" (
	"job_id" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"failure_kind" text,
	"failed_step" text,
	"error" text,
	"url" text,
	"upload_id" uuid,
	"upload_filename" text,
	"ingest_event_id" uuid,
	"steps" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_records_status" CHECK ("spideryarn"."import_records"."status" in ('done','error','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."import_records" ADD CONSTRAINT "import_records_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "spideryarn"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_records_finished_idx" ON "spideryarn"."import_records" USING btree ("finished_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_records_owner_slug_idx" ON "spideryarn"."import_records" USING btree ("owner_id","slug");--> statement-breakpoint

-- Appended by hand, below the generated table. Plan
-- docs/plans/261008i-a-failed-import-report-carries-the-address-and-a-record-of-every-import.md.
--
-- The two keys drizzle cannot declare: `auth.users` is outside its schema, and
-- the reservation key is composite.
--
-- OWNER: ON DELETE CASCADE, not `jobs`' RESTRICT. A record is the reader's own
-- import history kept for our debugging, and an erased account takes it with
-- it rather than being refused by it.
--
-- RESERVATION: composite with `owner_id`, as `jobs_ingest_event_fk`, so a
-- record can point at nobody else's reservation. SET NULL on just the
-- reservation column (Postgres 15+): `ingest_events` rows are never deleted in
-- the product, and a record must not be the thing that stops one going.
ALTER TABLE "spideryarn"."import_records"
  ADD CONSTRAINT "import_records_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "spideryarn"."import_records"
  ADD CONSTRAINT "import_records_ingest_event_fk"
  FOREIGN KEY ("ingest_event_id", "owner_id")
  REFERENCES "spideryarn"."ingest_events" ("id", "owner_id")
  ON DELETE SET NULL ("ingest_event_id");--> statement-breakpoint

-- A TRIGGER RATHER THAN APPLICATION CODE. Four code paths move a job into a
-- terminal status -- `settlingIfTerminal`, `requestCancel`, `settleExpired`'s
-- sweep and `settleIn` (src/store/pg-shelf.ts lists them) -- and `noteEnded`
-- is on two. A record written by one of them is a record that is missing
-- whenever a job ends another way, and a hand-run repair is a fifth way.
--
-- Fires on the transition INTO a terminal status only, so Dismiss stamping
-- `dismissed_at` on an ended job writes nothing; on an insert born terminal
-- too. ON CONFLICT DO NOTHING: one record is the FIRST terminal ending of one
-- job id. Retry makes a new job, and so a new record.
--
-- An import is a job whose steps include `fetch` -- `isImportJob` in
-- src/job-state.ts. `steps` is an array of OBJECTS, so the containment is
-- `[{"name":"fetch"}]`; `'["fetch"]'` matches nothing (docs/project/sql.md).
--
-- Security invoker: the app role has insert on every spideryarn table by
-- default privileges. `SET search_path = ''` and every name qualified, as
-- `ingest_events_freeze_article_price`.
CREATE OR REPLACE FUNCTION "spideryarn"."jobs_record_import"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  failed jsonb;
BEGIN
  IF NEW."status" NOT IN ('done', 'error', 'cancelled') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('done', 'error', 'cancelled') THEN
    RETURN NULL;
  END IF;
  IF NOT (NEW."steps" @> '[{"name":"fetch"}]'::jsonb) THEN
    RETURN NULL;
  END IF;

  SELECT step INTO failed
    FROM pg_catalog.jsonb_array_elements(NEW."steps") WITH ORDINALITY AS s(step, n)
   WHERE step ->> 'status' = 'error'
   ORDER BY n
   LIMIT 1;

  INSERT INTO "spideryarn"."import_records" (
    "job_id", "owner_id", "slug", "status", "failure_kind", "failed_step", "error",
    "url", "upload_id", "upload_filename", "ingest_event_id", "steps",
    "created_at", "started_at", "finished_at"
  ) VALUES (
    NEW."id", NEW."owner_id", NEW."slug", NEW."status", NEW."failure_kind",
    failed ->> 'name', coalesce(failed ->> 'error', NEW."error"),
    NEW."url", NEW."upload_id", NEW."upload_filename", NEW."ingest_event_id", NEW."steps",
    NEW."created_at", NEW."started_at", NEW."finished_at"
  )
  ON CONFLICT ("job_id") DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "jobs_record_import"
  AFTER INSERT OR UPDATE OF "status" ON "spideryarn"."jobs"
  FOR EACH ROW EXECUTE FUNCTION "spideryarn"."jobs_record_import"();
