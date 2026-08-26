-- The reader profile: docs/plans/reader-profile.md.
--
-- Two halves of one idea, and they land in two places because they answer two
-- questions. `articles.purpose` is "why am I reading THIS one" and belongs
-- beside the other shelf state on `articles` — NOT on `article_revisions`, for
-- the reason the comment block above those columns gives: a revision is one
-- extraction, and re-extracting must not throw away something the reader typed.
-- `reader_profiles` is "about me", true on every article, so it is keyed by
-- owner and has nothing to do with an article at all.

CREATE TABLE "spideryarn"."reader_profiles" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"profile" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ON DELETE RESTRICT, as in 0001 and 0003, and for the same reason: deleting
-- the account must not silently delete what the reader wrote. Hand-added here
-- rather than declared in src/db/schema.ts because `auth.users` is Supabase's
-- table and generation must never be invited to manage it.
--
-- Drizzle's snapshot does not know this constraint exists, so a future
-- generated migration that drops and recreates this table loses it SILENTLY.
-- tests/db-schema.test.ts is the guard — it asks pg_catalog rather than
-- trusting that nobody regenerated.
ALTER TABLE "spideryarn"."reader_profiles"
  ADD CONSTRAINT "reader_profiles_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "spideryarn"."articles" ADD COLUMN "purpose" text;
