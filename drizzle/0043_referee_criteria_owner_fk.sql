-- `referee_criteria`'s foreign key into auth.users, added by hand for the same
-- reason every other owner key is (drizzle/0001_auth_fks_and_guards.sql):
-- Supabase owns auth.users, and declaring it in the Drizzle schema would invite
-- migration generation to treat an Auth-owned table as ours to manage. So
-- `referee_criteria.owner_id` is a plain `uuid not null` in src/db/schema.ts and
-- the reference lives here. `search_runs_owner_fk` (drizzle/0003) is the row
-- this one is modelled on.
--
-- THE DRIFT THIS CREATES, restated because it is the whole reason this file is
-- separate: drizzle-kit's snapshot does not know about this constraint, so a
-- future generated migration that drops and recreates `referee_criteria` takes
-- it with it and says nothing. The alarm is tests/db-schema.test.ts, which asks
-- pg_constraint whether each of these still exists.
--
-- ON DELETE RESTRICT, matching its neighbours. Deleting an account is already
-- something this schema refuses to do quietly.

ALTER TABLE "spideryarn"."referee_criteria"
  ADD CONSTRAINT "referee_criteria_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
