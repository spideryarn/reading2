-- Debate's claims list: the claims an article rests on that someone outside
-- could argue with, for the Claims sub-mode to pick from —
-- docs/plans/261008i-debate-claims-picked-by-the-reader.md § 2.
--
-- One column and a constraint, the shape of 20261003103702_relations.sql.
--
-- `article_revisions.debate_claims` is one JSONB column beside `debate`: the
-- WHOLE artefact, because `sourceHash` is what says whether the article moved
-- underneath it. Nullable, and nothing is backfilled.
--
-- **The CHECK is hand-kept in src/db/schema.ts.** `drizzle-kit generate` emitted
-- the DROP/ADD pair below from the literal in the schema once that literal had
-- been widened by hand: the newest list (20261003103702_relations's) plus
-- `debate-claims`. `tests/db-step-constraint.test.ts` compares the last
-- `ADD CONSTRAINT` here with `STEP_ORDER` in both directions.
--
-- Nothing narrows: `'debate-claims'` is only ADDED and every existing name
-- stays, so there is no `revision_step_runs` row this can fail to validate
-- against.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "debate_claims" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','metadata','extract','blocks','structure','labels','assets','arc','tweets','glossary','quotes','skim','ideas','timeline','quiz','faq','relations','sketch','illustrated','debate','debate-claims','citations','crossrefs','simple'));