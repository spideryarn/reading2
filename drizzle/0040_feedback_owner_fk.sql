-- The feedback table's foreign key into auth.users, added by hand for the same
-- reason every other owner key is (drizzle/0001_auth_fks_and_guards.sql):
-- Supabase owns auth.users, and declaring it in the Drizzle schema would invite
-- migration generation to treat an Auth-owned table as ours to manage. So
-- `feedback.owner_id` is a plain `uuid not null` in src/db/schema.ts and the
-- reference lives here.
--
-- THE DRIFT THIS CREATES, restated because it is the whole reason this file is
-- separate: drizzle-kit's snapshot does not know about this constraint, so a
-- future generated migration that drops and recreates `feedback` takes it with
-- it and says nothing. The alarm is tests/db-schema.test.ts, which asks
-- pg_constraint whether each of these still exists.
--
-- ON DELETE RESTRICT, matching its neighbours. It means a little more here than
-- it does for the others: deleting an account must not quietly delete the bug
-- reports that account filed, because those are about the application rather
-- than about the person, and they may be the only record of a fault nobody has
-- fixed yet. If deleting a user ever needs to work, the reports get their owner
-- nulled or moved deliberately, in a migration somebody wrote on purpose.
ALTER TABLE "spideryarn"."feedback"
  ADD CONSTRAINT "feedback_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
