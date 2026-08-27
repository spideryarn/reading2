-- The Auth foreign key for `uploads`, and a note about the NOT NULL in 0014.
--
-- Hand-written for the same reason 0001 and 0003 are: `auth.users` is
-- Supabase's table, and declaring it in src/db/schema.ts would invite migration
-- generation to treat an Auth-owned object as ours to manage. Dropping it is not
-- a mistake anyone gets to undo.
--
-- Drizzle's snapshot does not know this constraint exists. A future generated
-- migration that drops and recreates `uploads` therefore loses it SILENTLY --
-- the table comes back, the app works, and nothing owns anything. The guard is
-- tests/db-schema.test.ts, which asks pg_catalog rather than trusting that
-- nobody regenerated.
--
-- The migration role needs USAGE on schema auth and REFERENCES on auth.users.
-- See docs/project/database.md.

-- ON DELETE RESTRICT, matching `jobs` rather than cascading.
--
-- The pair has to agree, and this is the reason: an upload is how a job got its
-- document, so a policy that deletes the upload while keeping the job leaves a
-- job that can never say where its article came from -- and `jobs.upload_id` is
-- ON DELETE SET NULL, which would take the id and leave `upload_filename`
-- behind, tripping `jobs_upload_both_or_neither`. One cascading and one
-- restricting is a retention policy nobody chose. GPT Sol's review of
-- docs/plans/durable-queue-and-uploads.md, 2026-08-27.
ALTER TABLE "spideryarn"."uploads"
  ADD CONSTRAINT "uploads_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;

--> statement-breakpoint

-- Column comments, so the pair of hashes is explained where somebody reading
-- the table finds it, rather than only in the TypeScript.
COMMENT ON COLUMN "spideryarn"."uploads"."claimed_sha256" IS
  'What the BROWSER said. Recorded so a mismatch can be reported; never treated as identity.';
--> statement-breakpoint
COMMENT ON COLUMN "spideryarn"."uploads"."sha256" IS
  'OURS, over the bytes that actually arrived. Null until verified. Do not merge with claimed_sha256.';
--> statement-breakpoint
COMMENT ON COLUMN "spideryarn"."uploads"."grant_expires_at" IS
  'The signed grant''s own clock, not this row''s. A sweep counting from minted_at can delete an object while its grant is still live, which re-arms that grant.';
--> statement-breakpoint

-- About `jobs.work_key text NOT NULL` in 0014, added with no default.
--
-- That fails on a table with rows, and it is safe here for a reason worth
-- writing down rather than trusting: **nothing has ever written spideryarn.jobs**.
-- The table has been in the schema since 0000 while the queue has been an
-- in-memory Map plus data/_jobs/*.json; src/store/import.ts imports articles and
-- reader state and skips `_`-prefixed directories, so it has never written one
-- either. Checked with `select count(*)`, not assumed.
--
-- Left NOT NULL with no default on purpose. If that assumption is wrong on some
-- machine, the failure is loud at migrate time rather than a silent column of
-- empty strings -- and a default of '' would have made every pre-existing job
-- identical work, which `jobs_active_slug` would then refuse all but one of.
SELECT 1;
