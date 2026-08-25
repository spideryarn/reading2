CREATE SCHEMA "spideryarn";
--> statement-breakpoint
CREATE TABLE "spideryarn"."ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid,
	"revision_id" uuid,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_micros" integer,
	"latency_ms" integer,
	"finish_reason" text,
	"error" text,
	"raw_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."article_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"status" text NOT NULL,
	"title" text,
	"byline" text,
	"site_name" text,
	"lang" text,
	"excerpt" text,
	"requested_url" text,
	"final_url" text,
	"fetched_at" timestamp with time zone,
	"raw_bytes" "bytea",
	"raw_content_type" text,
	"raw_encoding" text,
	"extracted_html" text,
	"stamped_html" text,
	"tree" jsonb,
	"arc" jsonb,
	"tweets" jsonb,
	"word_count" integer,
	"block_count" integer,
	"part_count" integer,
	"section_count" integer,
	"root_gist" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_revisions_article_id_id" UNIQUE("article_id","id"),
	CONSTRAINT "article_revisions_status" CHECK ("spideryarn"."article_revisions"."status" in ('draft','published','failed'))
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"current_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."block_identities" (
	"article_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_identities_article_id_block_id_pk" PRIMARY KEY("article_id","block_id"),
	CONSTRAINT "block_identities_id_format" CHECK ("spideryarn"."block_identities"."block_id" ~ '^spya-[a-hj-km-np-z2-9][a-hj-km-np-z0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."comments" (
	"article_id" uuid NOT NULL,
	"id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"quote" text NOT NULL,
	"start" integer NOT NULL,
	"status" text NOT NULL,
	"answer" text,
	"citations" jsonb,
	"searches" integer,
	"model" text,
	"error" text,
	"attempt_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_article_id_id_pk" PRIMARY KEY("article_id","id"),
	CONSTRAINT "comments_status" CHECK ("spideryarn"."comments"."status" in ('pending','done','error')),
	CONSTRAINT "comments_start" CHECK ("spideryarn"."comments"."start" >= 0)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"url" text,
	"title" text,
	"steps" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"cancelling" boolean DEFAULT false NOT NULL,
	"attempt_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_status" CHECK ("spideryarn"."jobs"."status" in ('queued','running','done','error','cancelled')),
	CONSTRAINT "jobs_id_format" CHECK ("spideryarn"."jobs"."id" ~ '^spya-[a-hj-km-np-z2-9][a-hj-km-np-z0-9]{5}$')
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."queue_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"running_job_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_state_singleton" CHECK ("spideryarn"."queue_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."revision_blocks" (
	"article_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"tag" text NOT NULL,
	"kind" text NOT NULL,
	"level" smallint,
	"text" text NOT NULL,
	"words" integer NOT NULL,
	"html" text NOT NULL,
	"gistable" boolean NOT NULL,
	"note" text,
	CONSTRAINT "revision_blocks_revision_id_block_id_pk" PRIMARY KEY("revision_id","block_id"),
	CONSTRAINT "revision_blocks_revision_ordinal" UNIQUE("revision_id","ordinal"),
	CONSTRAINT "revision_blocks_ordinal" CHECK ("spideryarn"."revision_blocks"."ordinal" >= 0),
	CONSTRAINT "revision_blocks_kind" CHECK ("spideryarn"."revision_blocks"."kind" in ('heading','text','quote','code','media','caption','other'))
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."revision_step_runs" (
	"revision_id" uuid NOT NULL,
	"step_name" text NOT NULL,
	"input_hash" text NOT NULL,
	"implementation_version" text NOT NULL,
	"prompt_version" text,
	"model" text,
	"status" text NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "revision_step_runs_revision_id_step_name_pk" PRIMARY KEY("revision_id","step_name"),
	CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','toc','arc','tweets')),
	CONSTRAINT "revision_step_runs_status" CHECK ("spideryarn"."revision_step_runs"."status" in ('running','done','error'))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_revision_id_article_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "spideryarn"."article_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD CONSTRAINT "article_revisions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."block_identities" ADD CONSTRAINT "block_identities_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_identity_fk" FOREIGN KEY ("article_id","block_id") REFERENCES "spideryarn"."block_identities"("article_id","block_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."queue_state" ADD CONSTRAINT "queue_state_running_job_id_jobs_id_fk" FOREIGN KEY ("running_job_id") REFERENCES "spideryarn"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_revision_fk" FOREIGN KEY ("article_id","revision_id") REFERENCES "spideryarn"."article_revisions"("article_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_identity_fk" FOREIGN KEY ("article_id","block_id") REFERENCES "spideryarn"."block_identities"("article_id","block_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_revision_id_article_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "spideryarn"."article_revisions"("id") ON DELETE cascade ON UPDATE no action;