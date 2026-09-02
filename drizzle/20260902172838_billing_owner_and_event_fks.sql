-- Three foreign keys the Drizzle schema deliberately does not declare.
--
-- The first two are the owner keys, added by hand for the same reason every
-- other owner key is (drizzle/0001_auth_fks_and_guards.sql): Supabase owns
-- auth.users, and declaring it in src/db/schema.ts would invite migration
-- generation to treat an Auth-owned table as ours to manage. So both `owner_id`
-- columns are plain `uuid` there and the references live here.
-- `referee_criteria_owner_fk` (drizzle/0043) is the row they are modelled on.
--
-- ON DELETE RESTRICT, matching every neighbour. It matters more here than
-- elsewhere: `ingest_events` is the record of what an account was charged for,
-- so a delete that took it silently would take the evidence with it.
--
-- THE DRIFT THIS CREATES, restated because it is the whole reason this file is
-- separate: drizzle-kit's snapshot does not know about these constraints, so a
-- future generated migration that drops and recreates either table takes them
-- with it and says nothing. The alarm is tests/db-schema.test.ts, which asks
-- pg_constraint whether each of these still exists.
--
-- THE THIRD ONE IS DIFFERENT, and it is here rather than in the schema because
-- it is composite. `jobs.ingest_event_id` references `(id, owner_id)` rather
-- than `id` alone, so **a job cannot spend another owner's reservation** — the
-- database refuses it rather than the application remembering not to. Drizzle
-- can express a composite foreign key, but the referenced side is
-- `ingest_events_id_owner`, a unique constraint that exists only to be pointed
-- at; keeping both halves in one place is clearer than splitting them.
--
-- ON DELETE NO ACTION is the default and is what is wanted: deleting a job
-- (readers can) leaves its reservation exactly where it was, and deleting a
-- reservation (nothing does) would be refused while a job still references it.
-- An earlier comment in schema.ts claimed a foreign key here would imply a
-- damaging cascade. It does not, and that mistake is why there was no key at
-- all until GPT Sol's review on 2026-09-02.

ALTER TABLE "spideryarn"."billing_accounts"
  ADD CONSTRAINT "billing_accounts_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events"
  ADD CONSTRAINT "ingest_events_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs"
  ADD CONSTRAINT "jobs_ingest_event_fk"
  FOREIGN KEY ("ingest_event_id", "owner_id")
  REFERENCES "spideryarn"."ingest_events" ("id", "owner_id");
