ALTER TABLE "spideryarn"."comments" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "severity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_severity" CHECK ("spideryarn"."comments"."severity" is null or "spideryarn"."comments"."severity" in ('major','minor'));