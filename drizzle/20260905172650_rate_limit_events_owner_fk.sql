-- `rate_limit_events.owner_id` really is a reader, and the database says so.
--
-- Declared by hand rather than in src/db/schema.ts, for the reason that file's
-- header gives: putting `auth.users` in the Drizzle schema would invite
-- migration generation to treat an Auth-owned table as ours to manage, and
-- dropping it is not a mistake we would get to undo. Drizzle's snapshot does not
-- know this constraint exists; tests/db-schema.test.ts is the guard that it is
-- still there after a future generated migration.
--
-- **`ON DELETE CASCADE`, and every other `owner_id` in this schema is
-- RESTRICT.** The difference is what the row is. Those are a reader's articles,
-- comments, reports and ledger entries, and restricting a delete on them is the
-- database refusing to lose something that matters. This table is bookkeeping:
-- one row per outbound fetch a pointer caused, deleted by the limiter itself as
-- soon as it falls out of the rolling hour. RESTRICT here would mean an account
-- could not be removed until its last hover aged out, which is a deletion
-- blocked by a counter — and nothing would be saved by blocking it.
--
-- docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md
-- § Stage 2; src/db/schema.ts § `rateLimitEvents`.
--
-- `link_previews` deliberately gets no such constraint: it has no owner at all,
-- which is the whole design. See its comment in src/db/schema.ts.
ALTER TABLE "spideryarn"."rate_limit_events"
  ADD CONSTRAINT "rate_limit_events_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;
