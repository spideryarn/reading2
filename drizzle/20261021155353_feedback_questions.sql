-- The questions an agent puts to an admin, served from here rather than compiled
-- into the build: docs/plans/261021h-agent-questions-reach-needs-a-decision-without-a-deploy.md.
--
-- Additive: one new table and nothing else. No existing table, column,
-- constraint or row is touched. src/db/schema.ts § `feedbackQuestions`
-- says what each column is for.
--
-- The app role reads it through the default privileges
-- docs/project/database.md § Roles sets on the `spideryarn` schema; nothing is
-- granted here.
CREATE TABLE "spideryarn"."feedback_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"report" text,
	"repeats" text[] DEFAULT '{}'::text[] NOT NULL,
	"asked" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"acted" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_questions_id_format" CHECK ("spideryarn"."feedback_questions"."id" ~ '^q-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "feedback_questions_report_format" CHECK ("spideryarn"."feedback_questions"."report" is null or "spideryarn"."feedback_questions"."report" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "feedback_questions_repeats_need_report" CHECK ("spideryarn"."feedback_questions"."report" is not null or cardinality("spideryarn"."feedback_questions"."repeats") = 0),
	CONSTRAINT "feedback_questions_title_shape" CHECK (length(btrim("spideryarn"."feedback_questions"."title")) > 0 and length("spideryarn"."feedback_questions"."title") <= 120),
	CONSTRAINT "feedback_questions_body_shape" CHECK (length(btrim("spideryarn"."feedback_questions"."body")) > 0 and length("spideryarn"."feedback_questions"."body") <= 6000),
	CONSTRAINT "feedback_questions_asked_format" CHECK ("spideryarn"."feedback_questions"."asked" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "feedback_questions_status" CHECK ("spideryarn"."feedback_questions"."status" in ('open', 'answered'))
);
