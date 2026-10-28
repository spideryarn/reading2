-- Explanations: the places a reader would get stuck, each with the missing
-- piece, owner only — docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md
-- § The step (Greg's report spya-nkq6rj).
--
-- One column and a constraint, the shape of 20261003103702_relations.sql.
--
-- `article_revisions.explanations` is one JSONB column beside `relations`: the
-- WHOLE artefact, because `sourceHash` and `profileHash` are what say whether
-- the article or the reader moved underneath it. Nullable, and nothing is
-- backfilled.
--
-- **The CHECK is hand-kept in src/db/schema.ts.** `drizzle-kit generate`
-- emitted the DROP/ADD pair below from the literal in the schema once that
-- literal had been widened by hand: the newest list plus `explanations`.
-- `tests/db-step-constraint.test.ts` compares the last `ADD CONSTRAINT` here
-- with `STEP_ORDER` in both directions.
--
-- Nothing narrows: `'explanations'` is only ADDED and every existing name
-- stays, so there is no `revision_step_runs` row this can fail to validate.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "explanations" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','metadata','extract','blocks','matter','structure','labels','assets','arc','tweets','glossary','quotes','skim','ideas','timeline','quiz','faq','relations','explanations','sketch','illustrated','debate','reception','debate-claims','sources-claims','citations','bibliography','citation-blurbs','situate','crossrefs','simple'));