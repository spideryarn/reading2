-- Auth foreign keys and indexes for the three reader-state tables added in 0002.
--
-- Hand-written for the same reason drizzle/0001_auth_fks_and_guards.sql is:
-- `auth.users` is Supabase's table, and declaring it in src/db/schema.ts would
-- invite migration generation to treat an Auth-owned object as ours to manage.
-- Dropping it is not a mistake anyone gets to undo.
--
-- Drizzle's snapshot does not know these constraints exist. A future generated
-- migration that drops and recreates one of these tables therefore loses them
-- SILENTLY — the tables come back, the app works, and nothing owns anything.
-- The guard is tests/db-schema.test.ts, which asks pg_catalog whether they are
-- still there rather than trusting that nobody regenerated.
--
-- The migration role needs USAGE on schema auth and REFERENCES on auth.users.
-- See docs/project/database.md.

-- ON DELETE RESTRICT, not CASCADE, exactly as in 0001: deleting the account
-- must not silently delete the reader's conversations, searches and lookups.
ALTER TABLE "spideryarn"."chat_threads"
  ADD CONSTRAINT "chat_threads_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;

--> statement-breakpoint

ALTER TABLE "spideryarn"."search_runs"
  ADD CONSTRAINT "search_runs_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;

--> statement-breakpoint

ALTER TABLE "spideryarn"."glossary_lookups"
  ADD CONSTRAINT "glossary_lookups_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;

--> statement-breakpoint

-- The thread list, newest first — what the chat panel opens with. Without this
-- it is a sequential scan of every message-bearing thread in the library, which
-- is fine at four articles and not at four hundred.
CREATE INDEX IF NOT EXISTS "chat_threads_article_updated_idx"
  ON "spideryarn"."chat_threads" ("article_id", "updated_at" DESC);

--> statement-breakpoint

-- Reading one conversation in order. The primary key leads on
-- (article_id, thread_id) so it already serves the lookup; this adds the sort,
-- which is what the panel actually asks for.
CREATE INDEX IF NOT EXISTS "chat_messages_thread_ordinal_idx"
  ON "spideryarn"."chat_messages" ("article_id", "thread_id", "ordinal");

--> statement-breakpoint

-- The saved-search list, newest first, and the input to the MAX_RUNS = 30 cap.
CREATE INDEX IF NOT EXISTS "search_runs_article_created_idx"
  ON "spideryarn"."search_runs" ("article_id", "created_at" DESC);
