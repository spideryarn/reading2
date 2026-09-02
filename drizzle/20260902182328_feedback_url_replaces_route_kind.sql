ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_route_kind";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP COLUMN "route_kind";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_url_shape" CHECK ("spideryarn"."feedback"."url" is null or (length(btrim("spideryarn"."feedback"."url")) > 0 and length("spideryarn"."feedback"."url") <= 2048));