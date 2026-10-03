-- The model's topic set for a reader's whole shelf, one row per owner — the
-- store stage of docs/plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md.
--
-- Additive: one new table and nothing else. No existing table, column,
-- constraint or row is touched.
--
-- The table is a cache of a model call: dropping every row costs one re-think
-- per shelf. src/db/schema.ts § `shelfTopicSets` says what each column is for,
-- and why `topics` and `members` are JSONB.
--
-- The `auth.users` foreign key is appended by hand at the bottom, for the
-- reason src/db/schema.ts's header gives (Drizzle must not learn about
-- `auth.users`). ON DELETE CASCADE, like `shelf_topic_scores`: a cache is
-- worth nothing once the reader is gone. tests/db-schema.test.ts checks it
-- survives.
CREATE TABLE "spideryarn"."shelf_topic_sets" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"model" text,
	"prompt_version" integer,
	"profile_hash" text,
	"topics" jsonb,
	"members" jsonb,
	"works" integer,
	"unplaced" integer,
	"rethought_at" timestamp with time zone,
	"filed_at" timestamp with time zone,
	"claim_id" uuid,
	"claimed_until" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"retry_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shelf_topic_sets_failures" CHECK ("spideryarn"."shelf_topic_sets"."failures" >= 0),
	CONSTRAINT "shelf_topic_sets_result" CHECK (num_nonnulls("spideryarn"."shelf_topic_sets"."model", "spideryarn"."shelf_topic_sets"."prompt_version", "spideryarn"."shelf_topic_sets"."profile_hash", "spideryarn"."shelf_topic_sets"."topics", "spideryarn"."shelf_topic_sets"."members", "spideryarn"."shelf_topic_sets"."works", "spideryarn"."shelf_topic_sets"."unplaced", "spideryarn"."shelf_topic_sets"."rethought_at") in (0, 8)),
	CONSTRAINT "shelf_topic_sets_filed" CHECK ("spideryarn"."shelf_topic_sets"."filed_at" is null or "spideryarn"."shelf_topic_sets"."rethought_at" is not null),
	CONSTRAINT "shelf_topic_sets_topics_array" CHECK ("spideryarn"."shelf_topic_sets"."topics" is null or jsonb_typeof("spideryarn"."shelf_topic_sets"."topics") = 'array'),
	CONSTRAINT "shelf_topic_sets_topics_nonempty" CHECK (case when "spideryarn"."shelf_topic_sets"."topics" is null then true when jsonb_typeof("spideryarn"."shelf_topic_sets"."topics") = 'array' then jsonb_array_length("spideryarn"."shelf_topic_sets"."topics") > 0 else false end),
	CONSTRAINT "shelf_topic_sets_members_object" CHECK ("spideryarn"."shelf_topic_sets"."members" is null or jsonb_typeof("spideryarn"."shelf_topic_sets"."members") = 'object'),
	CONSTRAINT "shelf_topic_sets_counts" CHECK (("spideryarn"."shelf_topic_sets"."works" is null or "spideryarn"."shelf_topic_sets"."works" >= 0) and ("spideryarn"."shelf_topic_sets"."unplaced" is null or "spideryarn"."shelf_topic_sets"."unplaced" >= 0)),
	CONSTRAINT "shelf_topic_sets_claim" CHECK (num_nonnulls("spideryarn"."shelf_topic_sets"."claim_id", "spideryarn"."shelf_topic_sets"."claimed_until") in (0, 2))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."shelf_topic_sets"
  ADD CONSTRAINT "shelf_topic_sets_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;
