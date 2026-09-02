-- The two billing tables' foreign keys into auth.users, added by hand for the
-- same reason every other owner key is (drizzle/0001_auth_fks_and_guards.sql):
-- Supabase owns auth.users, and declaring it in the Drizzle schema would invite
-- migration generation to treat an Auth-owned table as ours to manage. So both
-- `owner_id` columns are plain `uuid` in src/db/schema.ts and the references
-- live here. `referee_criteria_owner_fk` (drizzle/0043) is the row these are
-- modelled on.
--
-- THE DRIFT THIS CREATES, restated because it is the whole reason this file is
-- separate: drizzle-kit's snapshot does not know about these constraints, so a
-- future generated migration that drops and recreates either table takes them
-- with it and says nothing. The alarm is tests/db-schema.test.ts, which asks
-- pg_constraint whether each of these still exists.
--
-- ON DELETE RESTRICT, matching every neighbour. It matters more here than
-- elsewhere: `ingest_events` is the record of what an account was charged for,
-- so a delete that took it silently would take the evidence with it.
--
-- `jobs.ingest_event_id` deliberately gets NO foreign key into `ingest_events`,
-- and that is not an omission. Jobs are reader-deletable and reservations must
-- outlive them, so a cascade would destroy the ledger; `restrict` would make a
-- reader unable to delete their own job. The uniqueness that actually matters —
-- one job per slot — is `jobs_ingest_event_unique`, which is a real index.

ALTER TABLE "spideryarn"."billing_accounts"
  ADD CONSTRAINT "billing_accounts_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "spideryarn"."ingest_events"
  ADD CONSTRAINT "ingest_events_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
