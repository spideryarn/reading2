-- Relations: how each paragraph bears on the one before it, one word of ten,
-- read by Marginalia for the owner —
-- docs/plans/261003f-marginalia-relation-words-and-timeline-events.md § Stage 2.
--
-- One column and a constraint, the shape of 20260930163700_simple_summary.sql.
--
-- `article_revisions.relations` is one JSONB column beside `faq`: the WHOLE
-- artefact, because `sourceHash` is what says whether the article moved
-- underneath it. Nullable, and nothing is backfilled.
--
-- **The CHECK is hand-kept in src/db/schema.ts.** `drizzle-kit generate` emitted
-- the DROP/ADD pair below from the literal in the schema once that literal had
-- been widened by hand. Its list is the newest one — 20261002140803_structure_step's,
-- which has `metadata` and `structure` — plus `relations`.
-- `tests/db-step-constraint.test.ts` compares the last `ADD CONSTRAINT` here
-- with `STEP_ORDER` in both directions.
--
-- Nothing narrows: `'relations'` is only ADDED and every existing name stays, so
-- there is no `revision_step_runs` row this can fail to validate against.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "relations" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','metadata','extract','blocks','structure','labels','assets','arc','tweets','glossary','quotes','skim','ideas','timeline','quiz','faq','relations','sketch','illustrated','debate','citations','crossrefs','simple'));