-- Feedback takes 20,000 characters, up from 12,072: fifteen minutes of dictation. An admin's reply
-- to a question (261007d) is held to the same constant, so its CHECK moves from 12,000 with it.
-- Both only loosen, so every existing row stays legal. Plan 261007j; Greg said yes 2026-10-07.
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_body_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_question_answers" DROP CONSTRAINT "feedback_question_answers_body_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_body_shape" CHECK (length(btrim("spideryarn"."feedback"."body")) > 0 and length("spideryarn"."feedback"."body") <= 20000);--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_question_answers" ADD CONSTRAINT "feedback_question_answers_body_shape" CHECK (length(btrim("spideryarn"."feedback_question_answers"."body")) > 0 and length("spideryarn"."feedback_question_answers"."body") <= 20000);
