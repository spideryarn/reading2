ALTER TABLE "spideryarn"."articles" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_messages" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD COLUMN "renamed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "colour_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."link_summaries" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_claims" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_criteria" ADD COLUMN "colour_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."referee_criteria" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."search_runs" ADD COLUMN "colour_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."search_runs" ADD COLUMN "finished_at" timestamp with time zone;