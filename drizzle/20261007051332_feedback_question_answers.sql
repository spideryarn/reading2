-- An admin's replies to the questions agents ask him in the Feedback dialog:
-- stage 2 of docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md.
--
-- Additive: one new table and nothing else. No existing table, column,
-- constraint or row is touched. src/db/schema.ts § `feedbackQuestionAnswers`
-- says what each column is for.
--
-- The app role reads and writes it through the default privileges
-- docs/project/database.md § Roles sets on the `spideryarn` schema; nothing is
-- granted here.
--
-- The `auth.users` foreign key is appended by hand at the bottom, for the
-- reason src/db/schema.ts's header gives (Drizzle must not learn about
-- `auth.users`). ON DELETE RESTRICT, as `feedback_owner_fk` is
-- (drizzle/0040_feedback_owner_fk.sql): what an admin decided is a record of
-- the application's history, not of the account. tests/db-schema.test.ts
-- checks it survives.
CREATE TABLE "spideryarn"."feedback_question_answers" (
	"id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"body" text NOT NULL,
	"environment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_question_answers_owner_id_id_pk" PRIMARY KEY("owner_id","id"),
	CONSTRAINT "feedback_question_answers_id_format" CHECK ("spideryarn"."feedback_question_answers"."id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "feedback_question_answers_question_id_format" CHECK ("spideryarn"."feedback_question_answers"."question_id" ~ '^q-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "feedback_question_answers_environment" CHECK ("spideryarn"."feedback_question_answers"."environment" in ('production', 'preview', 'development', 'test')),
	CONSTRAINT "feedback_question_answers_body_shape" CHECK (length(btrim("spideryarn"."feedback_question_answers"."body")) > 0 and length("spideryarn"."feedback_question_answers"."body") <= 12000)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_question_answers"
  ADD CONSTRAINT "feedback_question_answers_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
