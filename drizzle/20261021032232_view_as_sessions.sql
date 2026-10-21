CREATE TABLE "spideryarn"."view_as_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce_hash" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "view_as_sessions_nonce_hash_unique" UNIQUE("nonce_hash"),
	CONSTRAINT "view_as_sessions_reason" CHECK (char_length("spideryarn"."view_as_sessions"."reason") between 1 and 300),
	CONSTRAINT "view_as_sessions_not_self" CHECK ("spideryarn"."view_as_sessions"."actor_id" <> "spideryarn"."view_as_sessions"."subject_id")
);
--> statement-breakpoint

-- The two `auth.users` keys, hand-added rather than declared in
-- src/db/schema.ts for the reason that file's header gives (Drizzle must not
-- learn about `auth.users`). ON DELETE CASCADE, like `reader_arrivals` and
-- `rate_limit_events`: a view-as row is bookkeeping about two accounts, and a
-- RESTRICT would stop a reader who was once viewed from erasing their account.
-- tests/db-schema.test.ts checks both survive. Plan 261019n § Part 3.
ALTER TABLE "spideryarn"."view_as_sessions"
  ADD CONSTRAINT "view_as_sessions_actor_fk"
  FOREIGN KEY ("actor_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "spideryarn"."view_as_sessions"
  ADD CONSTRAINT "view_as_sessions_subject_fk"
  FOREIGN KEY ("subject_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;
