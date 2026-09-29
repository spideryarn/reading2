-- The model's scores for a reader's candidate shelf topics, one row per owner
-- and scope — stage 2 of docs/plans/260929c-shelf-topics-chosen-by-a-model.md.
--
-- Additive: one new table, and `rate_limit_events_bucket` widened by one
-- bucket (`shelf-topics`, the per-owner hourly/daily cap and the global fuse on
-- this job's spend). Every existing bucket stays in the set, so no row can fail
-- the new constraint. The CHECK is hand-kept in src/db/schema.ts.
--
-- The table is a cache of a model call: dropping every row costs one call per
-- shelf, and the topic row falls back to the program's own list meanwhile.
-- src/db/schema.ts § `shelfTopicScores` says what each column is for.
--
-- The `auth.users` foreign key is appended by hand at the bottom, for the
-- reason src/db/schema.ts's header gives (Drizzle must not learn about
-- `auth.users`). ON DELETE CASCADE, like `link_summaries` and
-- `rate_limit_events`: a cache is worth nothing once the reader is gone.
-- tests/db-schema.test.ts checks it survives.
CREATE TABLE "spideryarn"."shelf_topic_scores" (
	"owner_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"input_hash" text,
	"model" text,
	"prompt_version" integer,
	"scores" jsonb,
	"computed_at" timestamp with time zone,
	"claim_id" uuid,
	"claim_hash" text,
	"claimed_until" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"retry_after" timestamp with time zone,
	CONSTRAINT "shelf_topic_scores_owner_id_scope_pk" PRIMARY KEY("owner_id","scope"),
	CONSTRAINT "shelf_topic_scores_scope" CHECK ("spideryarn"."shelf_topic_scores"."scope" in ('active','all')),
	CONSTRAINT "shelf_topic_scores_failures" CHECK ("spideryarn"."shelf_topic_scores"."failures" >= 0),
	CONSTRAINT "shelf_topic_scores_result" CHECK (num_nonnulls("spideryarn"."shelf_topic_scores"."input_hash", "spideryarn"."shelf_topic_scores"."model", "spideryarn"."shelf_topic_scores"."prompt_version", "spideryarn"."shelf_topic_scores"."scores", "spideryarn"."shelf_topic_scores"."computed_at") in (0, 5)),
	CONSTRAINT "shelf_topic_scores_scores_object" CHECK ("spideryarn"."shelf_topic_scores"."scores" is null or jsonb_typeof("spideryarn"."shelf_topic_scores"."scores") = 'object'),
	CONSTRAINT "shelf_topic_scores_claim" CHECK (num_nonnulls("spideryarn"."shelf_topic_scores"."claim_id", "spideryarn"."shelf_topic_scores"."claim_hash", "spideryarn"."shelf_topic_scores"."claimed_until") in (0, 3))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics'));--> statement-breakpoint
ALTER TABLE "spideryarn"."shelf_topic_scores"
  ADD CONSTRAINT "shelf_topic_scores_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE;
