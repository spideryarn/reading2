CREATE TABLE "spideryarn"."article_open_times" (
	"owner_id" uuid NOT NULL,
	"slot" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_open_times_owner_id_slot_pk" PRIMARY KEY("owner_id","slot")
);
--> statement-breakpoint

-- The owner key, hand-added rather than declared in src/db/schema.ts for the
-- reason that file's header gives (Drizzle must not learn about `auth.users`).
-- ON DELETE CASCADE, like `reader_arrivals`: a note of when the account opened
-- articles, worth nothing once the account is gone, and a RESTRICT would stop
-- the account being deleted at all. Not backfilled: it never claims an open it
-- did not see. docs/plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md.
ALTER TABLE "spideryarn"."article_open_times"
  ADD CONSTRAINT "article_open_times_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;
