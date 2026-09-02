-- Three boxes become one, and the old answers move into it.
--
-- docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md. The
-- Feedback dialog asked "steps to reproduce", "what you expected" and "what you
-- saw instead" in three boxes, and three boxes is a form. Greg, 2026-09-02:
--
--   It has three input boxes. I worry that will be intimidating/off-putting to
--   users, so let's combine them into one.
--
-- The reader this feature exists for is the one who was merely annoyed —
-- docs/reusable/silent-success.md is why most of what goes wrong here is only
-- ever detected by a person — and an instrument you have to fill in a form to
-- use is an instrument nobody uses.
--
-- ## The UPDATE is the whole reason this file is hand-edited
--
-- The previous migration added `body` nullable; this one fills it, makes it
-- `not null`, and only then drops the three columns. Generated DDL alone would
-- have dropped them with the reports still inside. Keeping the old headings
-- means a report filed on 2026-09-02 still reads as the three answers it was —
-- they are the same headings src/feedback.ts used to glue for Sentry, so the row
-- and the Sentry item still say the same thing. `concat_ws` skips nulls, so a
-- reader who filled in one box gets one heading rather than a heading over
-- nothing.
--
-- ## Why the new CHECK is 12072 and not 4000
--
-- The old cap was **per answer**. Three full ones plus their headings and the
-- blank lines between come to exactly 12,072 characters, so a 4,000 CHECK here
-- would fail the migration on a row that was legal when it was filed. The first
-- draft of this file wrote `left(…, 4000)` instead, and GPT Sol's review of the
-- plan was right to refuse it: truncating throws away something a reader wrote,
-- in a migration, where nobody would ever see that it had happened.
--
-- The reader's own limit is unchanged and lives in the route and the dialog —
-- `MAX_FEEDBACK_ANSWER_CHARS`, 4,000. This is the ceiling under which no
-- historical row is illegal: `MAX_FEEDBACK_BODY_CHARS` in src/types.ts.
--
-- Greg approved dropping the columns on 2026-09-02, having been asked, since
-- this reaches production: AGENTS.md § Real data belongs to the reader.
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_steps_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_expected_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_actual_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_says_something";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_body_shape";--> statement-breakpoint
UPDATE "spideryarn"."feedback"
   SET "body" = concat_ws(
     E'\n\n',
     case when "steps" is not null then 'Steps to reproduce:' || E'\n' || "steps" end,
     case when "expected" is not null then 'What you expected to see:' || E'\n' || "expected" end,
     case when "actual" is not null then 'What you saw instead:' || E'\n' || "actual" end
   )
 WHERE "body" is null;--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ALTER COLUMN "body" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP COLUMN "steps";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP COLUMN "expected";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP COLUMN "actual";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_body_shape" CHECK (length(btrim("spideryarn"."feedback"."body")) > 0 and length("spideryarn"."feedback"."body") <= 12072);
