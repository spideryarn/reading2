-- Which of a destination's mentions a summary is about, in the key.
--
-- A destination linked twice in one article is two questions. The card asks
-- *how does this page stand to the paragraph you are standing in*, and the two
-- paragraphs are different — so summarising the second mention against the
-- first one's paragraph produces an answer that is fluent, about a real
-- relationship in this piece, and about the wrong sentence. It is not rare: the
-- noema essay has two such pairs in sixty-two links. GPT Sol, 2026-09-05, P1-1;
-- docs/project/links.md.
--
-- **In the primary key rather than beside it.** The four fingerprints already
-- there would make the other mention a *miss* — the passage is inside
-- `context_hash` — but a miss on a shared key is the two mentions overwriting
-- each other, paying for a model call on every glance from one to the other.
-- Two mentions are two rows.
--
-- **The generated form of this migration would have failed twice**, and both
-- are worth naming rather than quietly fixing:
--
--   * it added the column *after* the constraint that names it, which Postgres
--     refuses;
--   * `ADD COLUMN … NOT NULL` with no default cannot be applied to a table that
--     has rows, and this one has them wherever anybody has hovered a link.
--
-- So the column arrives with a default of `''`, which is emptied out again
-- immediately: no article has a block called `''`, so every row written before
-- today is a row this build can never address. **That, and not the version
-- bump, is what retires them** — they are unreadable rather than stale, and
-- `sweepABatch` in src/store/pg-link-summaries.ts takes them thirty days past
-- their own expiry. Nothing is deleted here: these are cache rows, they cost a
-- fraction of a penny each to write again, and a migration that empties a table
-- is a habit worth not starting.
--
-- src/db/schema.ts § `linkSummaries`; docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md § Stage 4.
ALTER TABLE "spideryarn"."link_summaries" ADD COLUMN "block_id" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "spideryarn"."link_summaries" ALTER COLUMN "block_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "spideryarn"."link_summaries" DROP CONSTRAINT "link_summaries_owner_id_article_id_target_pk";--> statement-breakpoint
ALTER TABLE "spideryarn"."link_summaries" ADD CONSTRAINT "link_summaries_owner_id_article_id_target_block_id_pk" PRIMARY KEY("owner_id","article_id","target","block_id");
