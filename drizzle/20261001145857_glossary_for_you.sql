-- The owner's "for you" marks on the glossary — stage 2 of
-- docs/plans/261001m-shared-mode-output-for-everyone-personalisation-as-an-addendum.md.
--
-- One column and a constraint, the shape of 20260930163700_simple_summary.sql.
--
-- `article_revisions.glossary_for_you` is one nullable JSONB column: the WHOLE
-- artefact, written by the `glossaryForYou` step. **Owner-only** — it is
-- written from the owner's reader profile, so no public projection names it
-- (src/store/public-reader.ts; tests/public-reads.test.ts).
--
-- **The CHECK is hand-kept in src/db/schema.ts.** `drizzle-kit generate` emitted
-- the DROP/ADD pair below from the literal in the schema once that literal had
-- been widened by hand. `tests/db-step-constraint.test.ts` compares the last
-- `ADD CONSTRAINT` here with `STEP_ORDER` in both directions.
--
-- Nothing narrows: `'glossaryForYou'` is only ADDED and every existing name
-- stays, so there is no `revision_step_runs` row this can fail to validate
-- against. Additive throughout.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "glossary_for_you" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','hierarchy','labels','assets','arc','tweets','glossary','quotes','trajectory','ideas','timeline','quiz','faq','sketch','illustrated','debate','citations','crossrefs','simple','glossaryForYou'));