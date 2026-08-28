ALTER TABLE "spideryarn"."comments" DROP CONSTRAINT "comments_status";--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_body_nonempty" CHECK ("spideryarn"."comments"."body" is null or length(btrim("spideryarn"."comments"."body")) > 0);--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_status" CHECK ("spideryarn"."comments"."status" in ('none','pending','done','error'));