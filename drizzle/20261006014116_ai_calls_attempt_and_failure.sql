ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "attempt" smallint;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "failure_phase" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "failure_class" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "failure_status" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_failure_phase_known" CHECK ("spideryarn"."ai_calls"."failure_phase" is null or "spideryarn"."ai_calls"."failure_phase" in ('before_answer','mid_answer'));