-- Shelf filter terms: one revision's candidate phrases per extractor version —
-- stage 2 of docs/plans/260928a-shelf-facet-terms.md § Storage.
--
-- One new table, additive. Keyed on (revision_id, extractor_version) so a
-- version bump writes beside the old row; the composite foreign key to
-- article_revisions (article_id, id) makes an article/revision mismatch
-- impossible and cascades on delete. A cache of a deterministic function of the
-- revision's blocks: dropping every row loses nothing the next shelf load does
-- not recompute.
CREATE TABLE "spideryarn"."revision_phrase_runs" (
	"revision_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"extractor_version" smallint NOT NULL,
	"words" integer NOT NULL,
	"text_hash" text NOT NULL,
	"skipped" text,
	"candidates" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_phrase_runs_revision_id_extractor_version_pk" PRIMARY KEY("revision_id","extractor_version"),
	CONSTRAINT "revision_phrase_runs_skipped" CHECK ("spideryarn"."revision_phrase_runs"."skipped" is null or "spideryarn"."revision_phrase_runs"."skipped" in ('not-english','no-text')),
	CONSTRAINT "revision_phrase_runs_words" CHECK ("spideryarn"."revision_phrase_runs"."words" >= 0),
	CONSTRAINT "revision_phrase_runs_version" CHECK ("spideryarn"."revision_phrase_runs"."extractor_version" >= 1),
	CONSTRAINT "revision_phrase_runs_candidates_array" CHECK (jsonb_typeof("spideryarn"."revision_phrase_runs"."candidates") = 'array')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_phrase_runs" ADD CONSTRAINT "revision_phrase_runs_revision_fk" FOREIGN KEY ("article_id","revision_id") REFERENCES "spideryarn"."article_revisions"("article_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "revision_phrase_runs_article" ON "spideryarn"."revision_phrase_runs" USING btree ("article_id");