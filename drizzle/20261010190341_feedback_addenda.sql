-- An admin's addendum to one of their own earlier feedback reports:
-- stage 1 of docs/plans/261010o-addendum-to-an-earlier-feedback-report.md.
--
-- Additive: one new table, its index, and nothing else. No existing table,
-- column, constraint or row is touched. src/db/schema.ts § `feedbackAddenda`
-- says what each column is for.
--
-- `feedback_addenda_feedback_fk` is what makes "own reports only" a key: the
-- row is written under the signed-in owner, so it can only name a report of
-- that owner's. ON DELETE RESTRICT, so an addendum is never lost with its
-- report without somebody deciding it.
--
-- The app role reads and writes it through the default privileges
-- docs/project/database.md § Roles sets on the `spideryarn` schema; nothing is
-- granted here.
--
-- The `auth.users` foreign key is appended by hand at the bottom, as
-- `feedback_question_answers_owner_fk` is, and for the same reason.
-- tests/db-schema.test.ts checks it survives.
CREATE TABLE "spideryarn"."feedback_addenda" (
	"id" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"report_id" text NOT NULL,
	"body" text NOT NULL,
	"environment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_addenda_owner_id_id_pk" PRIMARY KEY("owner_id","id"),
	CONSTRAINT "feedback_addenda_id_format" CHECK ("spideryarn"."feedback_addenda"."id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "feedback_addenda_report_id_format" CHECK ("spideryarn"."feedback_addenda"."report_id" ~ '^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$'),
	CONSTRAINT "feedback_addenda_environment" CHECK ("spideryarn"."feedback_addenda"."environment" in ('production', 'preview', 'development', 'test')),
	CONSTRAINT "feedback_addenda_body_shape" CHECK (length(btrim("spideryarn"."feedback_addenda"."body")) > 0 and length("spideryarn"."feedback_addenda"."body") <= 1000000)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_addenda" ADD CONSTRAINT "feedback_addenda_feedback_fk" FOREIGN KEY ("owner_id","report_id") REFERENCES "spideryarn"."feedback"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_addenda_owner_report_idx" ON "spideryarn"."feedback_addenda" USING btree ("owner_id","report_id");
--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_addenda"
  ADD CONSTRAINT "feedback_addenda_owner_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;
