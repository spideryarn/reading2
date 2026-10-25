-- Keep the citation web-note writer deployed before `page_kind` compatible
-- with a row the new writer has already touched. Plan 261025d's reviewed
-- migration deliberately leaves the new column nullable: a legacy null note
-- reads as `own`, and a fresh legacy insert works. Its upsert has a second
-- case, though: on conflict the old writer names every old column but does not
-- name `page_kind`, so Postgres carries the new row's value forward. That can
-- make a strict /3 note inherit `looks-like`, or make note -> none fail the
-- CHECK which permits a non-null kind only beside a note.
--
-- Validation /3 is the one writer that predates the column. Null its inherited
-- kind; also keep every negative null regardless of writer. The current /4
-- writer still supplies both kinds explicitly on notes. This is a BEFORE
-- trigger so the existing CHECK sees the normalised row.
CREATE OR REPLACE FUNCTION "spideryarn"."citation_web_notes_normalise_page_kind"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW."state" = 'none' OR NEW."validation_version" = 'citation-web-note-checks/3' THEN
    NEW."page_kind" := NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "citation_web_notes_normalise_page_kind" ON "spideryarn"."citation_web_notes";--> statement-breakpoint
CREATE TRIGGER "citation_web_notes_normalise_page_kind"
  BEFORE INSERT OR UPDATE OF "state", "validation_version", "page_kind"
  ON "spideryarn"."citation_web_notes"
  FOR EACH ROW EXECUTE FUNCTION "spideryarn"."citation_web_notes_normalise_page_kind"();--> statement-breakpoint

-- Close the small gap between the column migration and this forward repair:
-- if a /3 conflict update already inherited a newer kind, it was a strict
-- note and therefore reads as `own` once the stale value is cleared.
UPDATE "spideryarn"."citation_web_notes"
   SET "page_kind" = NULL
 WHERE "validation_version" = 'citation-web-note-checks/3'
   AND "page_kind" IS NOT NULL;
