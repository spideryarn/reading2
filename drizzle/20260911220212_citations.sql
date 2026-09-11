-- Citations: every work the piece cites, where it cites it, and a link the
-- article itself gave — stage 1 of docs/plans/260911g-citations-mode.md.
--
-- One column and a constraint.
--
-- `article_revisions.citations` is one JSONB column beside `ideas`, `quotes`,
-- `timeline` and `debate`, for the reason src/db/schema.ts gives on all of
-- them: the WHOLE artefact, because `sourceHash` is what lets the panel ask
-- whether the article moved underneath the list. Each row carries its own
-- dedupe `key`, which is what a re-run inherits ids by and what stage 3's
-- stored web lookups will be keyed on.
--
-- **The CHECK is hand-kept in src/db/schema.ts, and this is the eighth comment
-- in a row saying so.** `drizzle-kit generate` emitted the pair below from the
-- literal in the schema; the literal is the part a person types, and
-- `tests/db-step-constraint.test.ts` compares the last `ADD CONSTRAINT` here with
-- `STEP_ORDER` in both directions.
--
-- Nothing narrows: `'citations'` is only ADDED and every existing name stays, so
-- there is no `revision_step_runs` row this can fail to validate against.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "citations" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','hierarchy','labels','assets','arc','tweets','glossary','quotes','ideas','timeline','quiz','sketch','illustrated','debate','citations'));
