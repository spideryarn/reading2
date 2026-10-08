-- An admin's "defer for now" on a question an agent asked in the Feedback dialog:
-- docs/plans/261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md, decision 3.
--
-- Additive: one new table and nothing else. No existing table, column,
-- constraint or row is touched. src/db/schema.ts § `feedbackQuestionDeferrals`
-- says what each column is for.
--
-- The app role reads and writes it through the default privileges
-- docs/project/database.md § Roles sets on the `spideryarn` schema; nothing is
-- granted here.
--
-- The `auth.users` foreign key is appended by hand at the bottom, as
-- `feedback_question_answers_owner_fk` is, and for the same reason.
CREATE TABLE "spideryarn"."feedback_question_deferrals" (
	"owner_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"deferred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"environment" text NOT NULL,
	CONSTRAINT "feedback_question_deferrals_owner_id_question_id_pk" PRIMARY KEY("owner_id","question_id"),
	CONSTRAINT "feedback_question_deferrals_question_id_format" CHECK ("spideryarn"."feedback_question_deferrals"."question_id" ~ '^q-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "feedback_question_deferrals_environment" CHECK ("spideryarn"."feedback_question_deferrals"."environment" in ('production', 'preview', 'development', 'test'))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_question_deferrals"
  ADD CONSTRAINT "feedback_question_deferrals_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
