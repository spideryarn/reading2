-- Quotes: the lines worth keeping, in the author's own words —
-- docs/project/quotes.md, docs/plans/quotes-mode.md.
--
-- One JSONB column beside `ideas` and `sketch`, for the reason src/db/schema.ts
-- gives on all of them and which earns its place twice here. Every quote holds a
-- `blockId` the pipeline found for itself and a `text` that was verified to be in
-- the article at write time — so a re-extraction can invalidate a row two ways at
-- once: the paragraph may be gone, and the words may no longer be in the piece.
-- Without `sourceHash` in the same document nothing could answer either question,
-- and the panel would go on offering the author's supposed sentences over an
-- article that no longer contains them.
--
-- **The CHECK is here because the schema's own literal was fixed, not because
-- drizzle-kit knows about it.** `drizzle-kit generate` diffs src/db/schema.ts and
-- has no idea a check expression exists — which is how `'summary'`, `'assets'`
-- (0029) and `'sketch'` (0031) were each left behind in turn. This migration also
-- repairs the third of those: `'sketch'` reached the database in 0031 by a
-- hand-written statement and never got back into the schema literal, so the two
-- had been out of step since. `tests/db-step-constraint.test.ts` is what makes
-- there not be a fifth.
--
-- Dropped and re-added rather than altered because Postgres has no ALTER for a
-- check expression.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "quotes" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','toc','assets','arc','tweets','glossary','quotes','summary','ideas','sketch'));