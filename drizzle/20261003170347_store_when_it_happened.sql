-- Store when it happened: seventeen nullable timestamp columns, no backfill.
-- docs/plans/261003j-store-when-it-happened-timestamp-audit.md.
--
-- The five `created_at` lines are hand-edited from what drizzle generated, on
-- purpose. `ADD COLUMN … DEFAULT now()` writes the migration's own time into
-- every existing row: an invented time for an event that happened earlier. So
-- each is added with no default (every existing row stays null, meaning "before
-- 2026-10-03, when we started keeping it") and only then given the default,
-- which applies to rows written from here on. The other twelve have no default
-- at all: the store writes them when the event happens.
ALTER TABLE "spideryarn"."articles" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_messages" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD COLUMN "renamed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_finds" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_finds" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_investigations" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_investigations" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "colour_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_hidden_entries" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_hidden_entries" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_lookups" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_lookups" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."link_summaries" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."reader_profiles" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."reader_profiles" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_claims" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_criteria" ADD COLUMN "colour_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_criteria" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."search_runs" ADD COLUMN "colour_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."search_runs" ADD COLUMN "finished_at" timestamp with time zone;
