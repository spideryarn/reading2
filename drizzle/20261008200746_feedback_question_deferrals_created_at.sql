-- When a question was first deferred: plan docs/plans/261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md.
-- deferred_at and updated_at both move on a later press, so neither keeps it.
--
-- Additive. NOT NULL with a default is safe: production gets this in the same
-- deploy as 20261008181231, which creates the table, so it has no rows to
-- give an invented time (docs/project/sql.md § Store when it happened).
ALTER TABLE "spideryarn"."feedback_question_deferrals" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
