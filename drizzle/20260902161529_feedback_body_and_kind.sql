ALTER TABLE "spideryarn"."feedback" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_body_shape" CHECK ("spideryarn"."feedback"."body" is null or (length(btrim("spideryarn"."feedback"."body")) > 0 and length("spideryarn"."feedback"."body") <= 4000));--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_kind" CHECK ("spideryarn"."feedback"."kind" is null or "spideryarn"."feedback"."kind" in ('problem', 'suggestion'));