-- Feedback takes 20,000 characters, up from 12,072: fifteen minutes of dictation.
-- Loosens only, so every existing row stays legal. Plan 261007j; Greg said yes 2026-10-07.
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_body_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_body_shape" CHECK (length(btrim("spideryarn"."feedback"."body")) > 0 and length("spideryarn"."feedback"."body") <= 20000);
