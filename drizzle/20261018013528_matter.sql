-- An article's front and back matter, as stretches of blocks the reading view
-- folds — stage 2 of
-- docs/plans/261018a-front-and-back-matter-marked-at-import-and-folded-by-default.md.
--
-- One column and a constraint, both additive.
--
-- `article_revisions.matter` is one JSONB column beside `crossrefs`: the WHOLE
-- artefact (`Matter`, src/types.ts), `{ status: "ok", version, generator,
-- sourceHash, stretches }` or `{ status: "unavailable", version, sourceHash,
-- reason }`. Null until the `matter` step has run; no backfill.
--
-- **The CHECK is hand-kept in src/db/schema.ts**, and drizzle-kit generated the
-- DROP/ADD pair below from that literal. `tests/db-step-constraint.test.ts`
-- compares the last `ADD CONSTRAINT` here with `STEP_ORDER`. Nothing narrows:
-- `'matter'` is only ADDED, so no existing `revision_step_runs` row can fail it.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "matter" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','metadata','extract','blocks','matter','structure','labels','assets','arc','tweets','glossary','quotes','skim','ideas','timeline','quiz','faq','relations','sketch','illustrated','debate','reception','debate-claims','sources-claims','citations','bibliography','crossrefs','simple'));