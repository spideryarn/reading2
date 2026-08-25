-- Everything the Drizzle schema cannot express, plus the guards that make two
-- of the plan's promises true rather than merely intended.
--
-- Written by hand, in a --custom migration rather than by editing 0000. That
-- distinction matters: hand-edits to a generated file vanish the next time
-- drizzle-kit regenerates it, and vanish silently. A separate file stays
-- visibly separate.
--
-- THE DRIFT THIS CREATES: Drizzle's snapshot does not know about anything
-- below. If a future generated migration drops and recreates one of these
-- tables, it takes these constraints with it and says nothing. The guard is
-- tests/db-schema.test.ts, which asserts each one still exists. Do not delete
-- those assertions for looking like tests of Postgres — they are testing that
-- two representations of one schema still agree.

--> statement-breakpoint

-- 1. The current-revision pointer.
--
-- Not in the Drizzle schema because it points at a table declared after it.
-- Composite on (id, current_revision_id) -> (article_id, id) so an article
-- cannot point at a revision belonging to a DIFFERENT article; on the revision
-- id alone it could.
--
-- Deliberately NOT deferrable. An earlier draft had it, assuming article and
-- revision must be inserted in one transaction pointing at each other. They
-- need not: current_revision_id is nullable, so creation is insert article,
-- insert revision, update pointer, and no intermediate state violates this.
--
-- NOTE what this does NOT enforce: that the pointer aims at a *published*
-- revision. A FK cannot see the other row's status. Publication has to check
-- it, in the same transaction that moves the pointer.
ALTER TABLE "spideryarn"."articles"
  ADD CONSTRAINT "articles_current_revision_fk"
  FOREIGN KEY ("id", "current_revision_id")
  REFERENCES "spideryarn"."article_revisions" ("article_id", "id");

--> statement-breakpoint

-- 2. Foreign keys into auth.users.
--
-- Supabase owns auth.users. Declaring it in the Drizzle schema would invite
-- migration generation to treat an Auth-owned table as ours to manage, and
-- "drizzle-kit dropped auth.users" is not a mistake anyone gets to undo.
--
-- The migration role needs USAGE on schema auth and REFERENCES on auth.users
-- for these three statements. See docs/project/database.md — that is a real
-- bootstrap requirement and the first thing to fail on a fresh project.
--
-- ON DELETE RESTRICT, not CASCADE: deleting the account must not silently
-- delete the library. With one user that is theoretical; it is also free.
ALTER TABLE "spideryarn"."articles"
  ADD CONSTRAINT "articles_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;

--> statement-breakpoint

ALTER TABLE "spideryarn"."comments"
  ADD CONSTRAINT "comments_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;

--> statement-breakpoint

ALTER TABLE "spideryarn"."jobs"
  ADD CONSTRAINT "jobs_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;

--> statement-breakpoint

-- 3. The queue_state row, and a trigger that stops it being deleted.
--
-- `CHECK (id = 1)` says "no more than one row". It does NOT say "exactly one
-- row", and the missing-row case is the dangerous one: claiming locks
-- queue_state FOR UPDATE before choosing a job, and `SELECT ... FOR UPDATE` over
-- zero rows locks nothing and returns happily. Every worker would then believe
-- it held the queue. Nothing would error.
--
-- Postgres cannot express "this table always has a row" as a constraint, so:
-- seed it here, and refuse deletion.
INSERT INTO "spideryarn"."queue_state" ("id") VALUES (1)
  ON CONFLICT ("id") DO NOTHING;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION "spideryarn"."queue_state_is_permanent"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'queue_state row is permanent: deleting it silently removes the global concurrency-1 guarantee';
END;
$$;

--> statement-breakpoint

CREATE TRIGGER "queue_state_no_delete"
  BEFORE DELETE ON "spideryarn"."queue_state"
  FOR EACH ROW EXECUTE FUNCTION "spideryarn"."queue_state_is_permanent"();

--> statement-breakpoint

-- 4. Indexes.
--
-- Two that an earlier draft had are deliberately NOT here:
--
--   * revision_blocks (revision_id, ordinal) — duplicated the index Postgres
--     already creates for UNIQUE(revision_id, ordinal). Checked against
--     pg_indexes rather than assumed.
--   * articles (owner_id, created_at DESC) — looked like it supported the
--     library's ordering and does not. LibraryEntry.addedAt is the *revision's*
--     fetched_at, not the article identity's creation time, so this index
--     answers a question the shelf never asks. Added back when a real query
--     needs it, against the column that query actually sorts on.
--
-- Claiming scans for the oldest queued job. Partial, because 'done' rows
-- accumulate forever and are never what claiming looks for. Still useful after
-- the queue_state lock: the lock serialises claimants, it does not find a row.
CREATE INDEX "jobs_queued_idx"
  ON "spideryarn"."jobs" ("created_at")
  WHERE "status" = 'queued';

--> statement-breakpoint

-- The rescue sweep looks for running jobs whose lease has expired.
CREATE INDEX "jobs_lease_idx"
  ON "spideryarn"."jobs" ("lease_expires_at")
  WHERE "status" = 'running';

--> statement-breakpoint

-- The job list, newest first. This one does match its query.
CREATE INDEX "jobs_owner_created_idx"
  ON "spideryarn"."jobs" ("owner_id", "created_at" DESC);

--> statement-breakpoint

-- 5. Roles and grants are NOT here, despite what this used to be called.
--
-- Creating a login role needs a password, and a password does not belong in a
-- migration committed to git. That is why this is called out rather than
-- quietly omitted: the security boundary is real work that has not been done,
-- and an empty section would read as if it had.
--
-- The steps are written out in docs/project/database.md § Roles. In short: a
-- runtime role with DML on spideryarn and nothing else, a separate migration
-- role with DDL, `spideryarn` kept out of the exposed schemas, and the
-- project's postgres superuser password nowhere near Vercel.
