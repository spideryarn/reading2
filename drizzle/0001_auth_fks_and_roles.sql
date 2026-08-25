-- Everything the Drizzle schema deliberately cannot express.
--
-- Written by hand, in a --custom migration rather than by editing 0000. That
-- distinction matters: hand-edits to a generated file are invisible the next
-- time drizzle-kit regenerates it, whereas a separate custom migration stays
-- visibly separate. See docs/plans/postgres-migration.md.
--
-- THE DRIFT THIS CREATES, stated plainly: Drizzle's snapshot does not know
-- about any of the statements below. If a future generated migration drops and
-- recreates one of these tables, it takes the constraints here with it and says
-- nothing. The guard is the catalog assertion test — tests/db-schema.test.ts, and
-- do not delete it because it looks like it is testing Postgres rather than us.
-- It is testing that two representations of the schema still agree.

--> statement-breakpoint

-- 1. The current-revision pointer.
--
-- Not in the Drizzle schema because it points at a table declared after it, and
-- Drizzle has no way to express that ordering. Composite on (id,
-- current_revision_id) -> (article_id, id) so an article cannot point at a
-- revision belonging to a DIFFERENT article — a plain FK on the id alone would
-- happily allow exactly that.
--
-- Deliberately NOT `deferrable initially deferred`. An earlier draft had it, on
-- the assumption that article and revision had to be inserted in one
-- transaction pointing at each other. They don't: current_revision_id is
-- nullable, so creation is insert article, insert revision, update pointer, and
-- no intermediate state ever violates this.
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
-- ON DELETE RESTRICT, not CASCADE: deleting the account should not silently
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

-- 3. Indexes the query plans actually need.
--
-- Not in the Drizzle schema only because they belong beside the constraints
-- they support; move them into TypeScript if that ever stops being true.

-- The library's list, newest first, and the /read/<slug> lookup already has the
-- unique index on slug.
CREATE INDEX "articles_owner_created_idx"
  ON "spideryarn"."articles" ("owner_id", "created_at" DESC);

--> statement-breakpoint

-- Loading an article means "every block of this revision, in document order".
-- Without this it is a sort every time.
CREATE INDEX "revision_blocks_ordinal_idx"
  ON "spideryarn"."revision_blocks" ("revision_id", "ordinal");

--> statement-breakpoint

-- Comments are read per article and shown in document order via the block's
-- ordinal, but they are fetched by article first.
CREATE INDEX "comments_article_block_idx"
  ON "spideryarn"."comments" ("article_id", "block_id");

--> statement-breakpoint

-- Claiming scans for the oldest queued job. Partial, because 'done' rows
-- accumulate forever and are never what claiming is looking for.
CREATE INDEX "jobs_queued_idx"
  ON "spideryarn"."jobs" ("created_at")
  WHERE "status" = 'queued';

--> statement-breakpoint

-- The rescue sweep looks for running jobs whose lease has expired.
CREATE INDEX "jobs_lease_idx"
  ON "spideryarn"."jobs" ("lease_expires_at")
  WHERE "status" = 'running';

--> statement-breakpoint

-- 4. Roles and grants are NOT here, despite this file's name.
--
-- Creating a login role needs a password, and a password does not belong in a
-- migration committed to git — which is the whole reason this is called out
-- rather than quietly omitted. Roles are an ops step, run once against the
-- project by a human, and written down in docs/project/database.md.
--
-- What that step must do:
--   * create a runtime login role with SELECT/INSERT/UPDATE/DELETE on
--     spideryarn.* and NOTHING else — in particular no access to `public`;
--   * create a separate migration role with DDL on spideryarn and
--     spideryarn_migrations;
--   * leave `spideryarn` out of the project's exposed schemas, so PostgREST
--     cannot see it whatever the anon key is;
--   * never put the project's `postgres` superuser password in Vercel.
--
-- The catalog test asserts the negative — that the runtime role cannot read
-- another schema's tables. A privilege you believe you did not grant is exactly
-- the kind of thing that stays true until someone runs a convenience GRANT to
-- fix an unrelated error.

--> statement-breakpoint

-- 5. The singleton queue row.
--
-- Claiming locks this row FOR UPDATE before choosing a job, which is what gives
-- global concurrency 1. `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` does NOT:
-- it lets two workers claim two DIFFERENT queued jobs. If the row is missing,
-- claiming locks nothing and the guarantee is silently gone — so it is inserted
-- here rather than lazily by application code.
INSERT INTO "spideryarn"."queue_state" ("id") VALUES (1)
  ON CONFLICT ("id") DO NOTHING;
