-- FAQ: the questions a careful reader would put to the piece while reading it,
-- and the passages where it responds — stage 1 of docs/plans/260916d-faq-mode.md.
--
-- One column and a constraint.
--
-- `article_revisions.faq` is one JSONB column beside `ideas`, `quiz` and
-- `citations`, for the reason src/db/schema.ts gives on all of them: the WHOLE
-- artefact, because `sourceHash` is what lets the panel ask whether the article
-- moved underneath the list.
--
-- **The CHECK is hand-kept in src/db/schema.ts.** `drizzle-kit generate` emitted
-- the DROP/ADD pair below from the literal in the schema once that literal had
-- been widened by hand; it cannot see a CHECK change the literal does not make.
-- `tests/db-step-constraint.test.ts` compares the last `ADD CONSTRAINT` here
-- with `STEP_ORDER` in both directions.
--
-- Nothing narrows: `'faq'` is only ADDED and every existing name stays, so
-- there is no `revision_step_runs` row this can fail to validate against.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "faq" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','hierarchy','labels','assets','arc','tweets','glossary','quotes','ideas','timeline','quiz','faq','sketch','illustrated','debate','citations'));
