CREATE TABLE "spideryarn"."chat_messages" (
	"article_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"citations" jsonb,
	"searches" integer,
	"model" text,
	"error" text,
	"stopped" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_article_id_thread_id_id_pk" PRIMARY KEY("article_id","thread_id","id"),
	CONSTRAINT "chat_messages_thread_ordinal" UNIQUE("article_id","thread_id","ordinal"),
	CONSTRAINT "chat_messages_role" CHECK ("spideryarn"."chat_messages"."role" in ('user','assistant')),
	CONSTRAINT "chat_messages_status" CHECK ("spideryarn"."chat_messages"."status" in ('pending','done','error')),
	CONSTRAINT "chat_messages_ordinal" CHECK ("spideryarn"."chat_messages"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."chat_threads" (
	"article_id" uuid NOT NULL,
	"id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_threads_article_id_id_pk" PRIMARY KEY("article_id","id"),
	CONSTRAINT "chat_threads_id_format" CHECK ("spideryarn"."chat_threads"."id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$')
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."glossary_lookups" (
	"article_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"searches" integer NOT NULL,
	"model" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "glossary_lookups_article_id_entry_id_pk" PRIMARY KEY("article_id","entry_id"),
	CONSTRAINT "glossary_lookups_entry_id_format" CHECK ("spideryarn"."glossary_lookups"."entry_id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "glossary_lookups_searches" CHECK ("spideryarn"."glossary_lookups"."searches" >= 0)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."search_runs" (
	"article_id" uuid NOT NULL,
	"id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"criterion" text NOT NULL,
	"status" text NOT NULL,
	"hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_runs_article_id_id_pk" PRIMARY KEY("article_id","id"),
	CONSTRAINT "search_runs_status" CHECK ("spideryarn"."search_runs"."status" in ('pending','done','error')),
	CONSTRAINT "search_runs_id_format" CHECK ("spideryarn"."search_runs"."id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "glossary" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "summary" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "labels" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "guidance" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_messages" ADD CONSTRAINT "chat_messages_thread_fk" FOREIGN KEY ("article_id","thread_id") REFERENCES "spideryarn"."chat_threads"("article_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_lookups" ADD CONSTRAINT "glossary_lookups_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."search_runs" ADD CONSTRAINT "search_runs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','toc','arc','tweets','glossary','summary'));