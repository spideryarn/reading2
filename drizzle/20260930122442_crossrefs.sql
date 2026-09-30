-- Cross-references: a phrase in one block linked to the block that shows it in
-- detail — stage 1 of
-- docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md.
--
-- One column and a constraint.
--
-- `article_revisions.crossrefs` is one JSONB column beside `ideas` and `faq`:
-- the WHOLE artefact, because `sourceHash` is what says whether the article
-- moved underneath the links (and a stale list is not drawn).
--
-- **The CHECK is hand-kept in src/db/schema.ts.** `drizzle-kit generate` emitted
-- the DROP/ADD pair below from the literal in the schema once that literal had
-- been widened by hand. `tests/db-step-constraint.test.ts` compares the last
-- `ADD CONSTRAINT` here with `STEP_ORDER` in both directions.
--
-- Nothing narrows: `'crossrefs'` is only ADDED and every existing name stays,
-- so there is no `revision_step_runs` row this can fail to validate against.
--
-- Regenerated on 2026-09-30 after 20260930102351_ai_calls_article_index
-- landed on dev with a later stamp than the first draft of this file
-- (docs/project/database.md § Repairing a fork). The DDL is unchanged.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "crossrefs" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','hierarchy','labels','assets','arc','tweets','glossary','quotes','trajectory','ideas','timeline','quiz','faq','sketch','illustrated','debate','citations','crossrefs'));