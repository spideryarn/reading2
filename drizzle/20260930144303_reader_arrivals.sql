-- One row per account the server has seen: the ledger that says which request
-- is an account's first, so the admin hears about each sign-up exactly once.
-- docs/plans/260930i-email-admin-on-sign-up-and-plan-upgrade.md.

CREATE TABLE "spideryarn"."reader_arrivals" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- The owner key, hand-added rather than declared in src/db/schema.ts for the
-- reason that file's header gives (Drizzle must not learn about `auth.users`).
-- ON DELETE CASCADE, like `link_summaries` and `rate_limit_events`: the row is
-- bookkeeping about an account, worth nothing once the account is gone, and a
-- RESTRICT would stop the account being deleted at all.
-- tests/db-schema.test.ts checks it survives.
ALTER TABLE "spideryarn"."reader_arrivals"
  ADD CONSTRAINT "reader_arrivals_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;
--> statement-breakpoint

-- **Every account that already exists has already arrived.** Without this, the
-- first request after deploy from each existing reader would announce them as
-- a new sign-up. Migrations run as `postgres`, which can read `auth.users`
-- (docs/project/database.md); the deployed server's role cannot, and does not
-- need to. `first_seen_at` is the account's own creation time, the closest
-- truth available for somebody who arrived before there was a ledger.
INSERT INTO "spideryarn"."reader_arrivals" ("owner_id", "first_seen_at")
SELECT "id", coalesce("created_at", now()) FROM "auth"."users"
ON CONFLICT ("owner_id") DO NOTHING;
