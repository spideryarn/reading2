-- Debate: what the rest of the web says about this piece, and the fourteenth
-- mode — docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.
--
-- One column and the step CHECK, exactly like drizzle/20260903053705_illustrated.sql.
--
-- `article_revisions.debate` is one JSONB column beside `ideas`, `quotes`,
-- `timeline`, `quiz`, `sketch` and `illustrated`, and it is the first artefact
-- column holding text this app neither wrote nor fetched: every row carries
-- quoted passages of a stranger's web page, returned by OpenRouter's own
-- server-side search and capped at 8,000 characters (`MAX_EVIDENCE_EXCERPT`,
-- src/openrouter-stream.ts) before they reach memory. They are stored so a
-- reader can check the claim being made about that page; they are rendered as
-- text and never as markup; and every URL in here is re-judged by
-- `publicCitationUrl` at the public boundary rather than trusted because it is
-- stored.
--
-- `sourceHash` on this artefact is `articleWithIdsFingerprint` — the blocks, the
-- tree and the cited head — because the second of its two passes shows the model
-- the article with its block ids on it. `searchedAt` beside it is **when the
-- search ran** and is displayed provenance rather than staleness: a shared link
-- outlives the research, and a visitor opening a year-old article is owed the
-- date without the artefact declaring itself invalid.
--
-- The CHECK is dropped and re-added because Postgres has no ALTER for a check
-- expression. Nothing narrows — 'debate' is only ever ADDED — so there is no
-- existing row in `revision_step_runs` this can fail to validate against, which
-- is the trap the other direction has (0036). drizzle-kit 0.31.10 emitted both
-- statements unprompted, as it did for `illustrated`; the literal in
-- src/db/schema.ts is still hand-kept and tests/db-step-constraint.test.ts is
-- still what makes there not be a third drift.

ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "debate" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks','hierarchy','assets','arc','tweets','glossary','quotes','ideas','timeline','quiz','sketch','illustrated','debate'));