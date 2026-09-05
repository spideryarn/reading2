-- `link_summaries.owner_id` really is a reader, and the database says so.
--
-- Declared by hand rather than in src/db/schema.ts, for the reason that file's
-- header gives: putting `auth.users` in the Drizzle schema would invite
-- migration generation to treat an Auth-owned table as ours to manage, and
-- dropping it is not a mistake we would get to undo. Drizzle's snapshot does not
-- know this constraint exists; tests/db-schema.test.ts is the guard that it is
-- still there after a future generated migration.
--
-- **`ON DELETE CASCADE`, matching `rate_limit_events` and not the rest of the
-- schema.** Every other `owner_id` here is RESTRICT, and the difference is what
-- the row is. Those are a reader's articles, comments, reports and ledger
-- entries, and restricting a delete on them is the database refusing to lose
-- something that matters. This is a cache: one paragraph about a link, rewritten
-- whenever the article, the profile or the prompt moves, and worth nothing at
-- all once the reader is gone. RESTRICT would mean an account could not be
-- removed until its last hover expired.
--
-- The `articles` foreign key on the migration before this one is already
-- CASCADE for the same reason — a summary about an article nobody has any more
-- is not a thing to keep.
--
-- docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md
-- § Stage 3; src/db/schema.ts § `linkSummaries`.
ALTER TABLE "spideryarn"."link_summaries"
  ADD CONSTRAINT "link_summaries_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;
