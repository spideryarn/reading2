-- Illustrated: the same argument painted, and the fifth diagram sub-mode —
-- docs/plans/260903c-illustrated-diagram-sub-mode.md, docs/project/diagram.md
-- § Illustrated.
--
-- One column and the step CHECK, exactly like drizzle/0046_quiz.sql.
--
-- `article_revisions.illustrated` is one JSONB column beside `ideas`, `quotes`,
-- `timeline`, `quiz` and `sketch`, and holds **the brief and where the pictures
-- are, never the pictures**. Each plate carries a sha256, an extension and the
-- dimensions; the bytes are content-addressed objects in the `sources` bucket at
-- `sha256/<hash>.jpeg`, put there by src/illustrated-image.ts — the same place
-- the article's own figures go. Base64 here would be about 200 KB a plate
-- dragged along by every read of this revision that named the column, which is
-- the call `assets` already made.
--
-- **`sourceHash` on this artefact is a hash of the SKETCH, not of the article**,
-- and it is the only column here of which that is true. A forced Sketch redraw
-- changes the scene with every article byte identical, so an article-shaped
-- fingerprint would leave a stale illustration reporting itself current.
-- `profileHash` is inherited from that Sketch for the matching reason: a picture
-- painted from a personalised Sketch is itself personalised, and an owner about
-- to publish is owed that fact. src/illustrated.ts § `inputFingerprint`.
--
-- **The CHECK is normally hand-written and this time it was not.** Every one of
-- 0029, 0031, 0035 and 0046 says `drizzle-kit generate` cannot see a check
-- expression; on drizzle-kit 0.31.10 it can, and it emitted the drop and the
-- re-add below unprompted. That does not make the literal in src/db/schema.ts
-- any less hand-kept — it is still the thing generate diffs *from* — so
-- tests/db-step-constraint.test.ts, which compares the last ADD CONSTRAINT in
-- these files with `STEP_ORDER` in both directions, remains the check that
-- matters. Verified against it, 2026-09-03.
--
-- Dropped and re-added rather than altered because Postgres has no ALTER for a
-- check expression. Nothing narrows — 'illustrated' is only ever ADDED — so
-- there is no existing row in `revision_step_runs` this can fail to validate
-- against, which is the trap the other direction has (0036).

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "illustrated" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','hierarchy','assets','arc','tweets','glossary','quotes','ideas','timeline','quiz','sketch','illustrated'));