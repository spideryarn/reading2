-- Reception's and Claims' stored names, `debate` → `reception`, `debate-claims`
-- → `sources-claims`, `debate-check` → `sources-claim-check`: the EXPAND half.
-- docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md § The
-- database, § After GPT Sol's plan review (F1, F2, F3, F5, F8), Stage 3.
--
-- Stage 2's machinery (drizzle/20261010030345_bibliography_expand.sql),
-- extended, for the same reason: `npm run deploy` applies migrations and then
-- waits for Vercel, so for those minutes production runs the pre-rename code
-- against this schema. That code names `article_revisions.debate` and
-- `.debate_claims`, the steps `debate` and `debate-claims`, the table
-- `debate_claim_checks` and the rate bucket `debate-check`. So this migration
-- only ADDS, and keeps both spellings true whichever version writes:
--
-- 1. `article_revisions.reception` and `.sources_claims`, copies of `debate`
--    and `debate_claims`, kept equal to them by the SAME trigger function as
--    Stage 2's (`article_revisions_mirror_renamed`), recreated here with all
--    three pairs; the trigger is recreated with all six columns in its
--    `UPDATE OF` list.
-- 2. `revision_step_runs`: the CHECK (generated above) admits both names of
--    each step; the `debate` and `debate-claims` rows are COPIED under the new
--    names (the old rows stay); and `step_name_partner`, which Stage 2's
--    step-run mirror trigger reads, is recreated with the two new pairs, so
--    every insert, update and delete on one spelling is mirrored onto the other.
-- 3. `chat_threads`: the origin CHECKs (generated above) admit `reception` (a
--    lens) and `sources-claims` (a claim) beside `debate`, which is still
--    either. Rows are NOT rewritten: the new code reads `debate` by its shape
--    (src/types.ts § `currentOriginMode`) and writes the new words.
-- 4. `debate_claim_checks` is RENAMED to `sources_claim_checks` (generated
--    above), and a view of the old name is put over it (below) for the old
--    code. A one-table `SELECT *` view is automatically updatable, so the old
--    store's inserts, updates and selects keep working through it. **Every
--    constraint and index keeps its `debate_claim_checks_*` name** (GPT Sol's
--    F3): the old store recognises the one-pending violation by the index's
--    literal name, and the new store accepts either.
-- 5. `rate_limit_events_bucket` (generated above) admits `sources-claim-check`
--    beside `debate-check`; the limiter counts both (src/store/contracts.ts §
--    `RETIRED_RATE_BUCKETS`, F2). Rows are not rewritten.
-- 6. `stale_notice_dismissals_mode` (generated above) admits `reception` and
--    `sources-claims` beside `debate` and `debate-claims`, as
--    drizzle/20261010044614_stale_notice_bibliography.sql did for
--    `bibliography`. Rows are not rewritten.
-- 7. `jobs.steps` / `jobs.reset` are NOT rewritten: the new code reads the old
--    step names through `RETIRED_STEPS` (src/step-order.ts), as Stage 2 does.
--
-- **What drizzle-kit generated and this file leaves out.** Renaming the table
-- made it drop and re-add the four `debate_claim_checks_*` CHECKs, the article
-- foreign key and the one-pending index, because its snapshot spells each with
-- the table's name. Postgres keeps all six through `RENAME TO` (they belong to
-- the table, not to its name), with the same names and the same definitions, so
-- re-making them would only rebuild an index and re-validate the table for
-- nothing. The snapshot written beside this file records them under the new
-- name, which is what schema.ts says; `npm run db:generate -- --allow-empty`
-- answers no schema changes. The table rename was answered `rename` to
-- drizzle-kit's prompt (in a pseudo-terminal), not `create`.
--
-- **Undone by the CONTRACT migration**, which is not in `drizzle/`: plan
-- 261009w's Overseer queue item, safe only once this deploy is live. It drops
-- the columns `debate` and `debate_claims` (and Stage 2's `citations`), the
-- column trigger and the step-run mirror with their functions; deletes the old
-- step runs and narrows the step CHECK; rewrites `jobs.steps`, `jobs.reset`,
-- the chat origins (a `debate` row by its shape), the bucket rows and the
-- stale-notice rows, then narrows their CHECKs; drops the
-- `debate_claim_checks` view and renames the claim-check constraints and index
-- to `sources_claim_checks_*`; and removes `legacyDebate`,
-- `legacyDebateClaims` and the old-name literals from src/db/schema.ts.
--
-- What is deliberately NOT changed: the prompt version tags `debate/7`,
-- `debate-claims/1` and `debate-check/1` (stored in each artefact's `version`,
-- in `revision_step_runs.prompt_version` and in each check's
-- `prompt_version`; changing them would mark every unchanged artefact
-- outdated), `jobs.work_key` (a hash SQL cannot recompute), `ai_calls` (append
-- only, read through `currentLedgerName`) and `feedback` rows (evidence).
--
-- ---------------------------------------------- generated by drizzle-kit --
ALTER TABLE "spideryarn"."debate_claim_checks" RENAME TO "sources_claim_checks";--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" DROP CONSTRAINT "chat_threads_origin_mode";--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" DROP CONSTRAINT "chat_threads_origin_lens_debate_only";--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step";--> statement-breakpoint
ALTER TABLE "spideryarn"."stale_notice_dismissals" DROP CONSTRAINT "stale_notice_dismissals_mode";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "reception" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "sources_claims" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_origin_reception" CHECK ("spideryarn"."chat_threads"."origin_mode" is distinct from 'reception' or ("spideryarn"."chat_threads"."origin_item_id" is null and "spideryarn"."chat_threads"."origin_block_id" is null and "spideryarn"."chat_threads"."origin_quote" is null and "spideryarn"."chat_threads"."origin_lens" is not null));--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_origin_sources_claims" CHECK ("spideryarn"."chat_threads"."origin_mode" is distinct from 'sources-claims' or ("spideryarn"."chat_threads"."origin_item_id" is null and "spideryarn"."chat_threads"."origin_block_id" is not null and "spideryarn"."chat_threads"."origin_quote" is not null and "spideryarn"."chat_threads"."origin_lens" is null));--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_origin_mode" CHECK ("spideryarn"."chat_threads"."origin_mode" is null or "spideryarn"."chat_threads"."origin_mode" in ('debate','reception','sources-claims','summary','glossary','citations','bibliography','ideas'));--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_origin_lens_debate_only" CHECK ("spideryarn"."chat_threads"."origin_lens" is null or "spideryarn"."chat_threads"."origin_mode" in ('reception','debate'));--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics', 'upload-source-guess', 'citation-investigate', 'dig-deeper', 'feedback-notice', 'help-chat', 'debate-check', 'sources-claim-check'));--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','metadata','extract','blocks','structure','labels','assets','arc','tweets','glossary','quotes','skim','ideas','timeline','quiz','faq','relations','sketch','illustrated','debate','reception','debate-claims','sources-claims','citations','bibliography','crossrefs','simple'));--> statement-breakpoint
ALTER TABLE "spideryarn"."stale_notice_dismissals" ADD CONSTRAINT "stale_notice_dismissals_mode" CHECK ("spideryarn"."stale_notice_dismissals"."mode" in ('glossary', 'ideas', 'faq', 'timeline', 'simple', 'bibliography', 'tweets', 'reception', 'sources-claims', 'quotes', 'skim', 'search', 'sketch', 'illustrated', 'claims', 'citations', 'debate', 'debate-claims'));--> statement-breakpoint

-- ------------------------------------------------------ written by hand --

-- 4. The old table name, as a view over the renamed table, for the code
--    deployed before this rename. `SELECT *` over one table with nothing else
--    is automatically updatable, and an `INSERT` through it that leaves a
--    column out takes the table's default (`results`, `dig_further`,
--    `created_at`), so the old store's statements run unchanged; a
--    unique violation through it still names `debate_claim_checks_one_pending`.
CREATE VIEW "spideryarn"."debate_claim_checks" AS SELECT * FROM "spideryarn"."sources_claim_checks";--> statement-breakpoint

-- The view's grants are the table's, copied rather than written out: the app
-- role reads and writes the table through the default privileges
-- docs/project/database.md § Step three sets (which a view created by the same
-- owner also gets), and this copies whatever is actually on the table, so the
-- old code cannot be refused through the view anything it could do before.
DO $$
DECLARE
  g record;
BEGIN
  FOR g IN
    SELECT pg_get_userbyid(a.grantee) AS grantee, a.privilege_type
      FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = '"spideryarn"."sources_claim_checks"'::regclass
       AND a.grantee <> c.relowner
       AND a.grantee <> 0
  LOOP
    EXECUTE format('GRANT %s ON "spideryarn"."debate_claim_checks" TO %I', g.privilege_type, g.grantee);
  END LOOP;
END $$;--> statement-breakpoint

-- 1. The column pairs. The copies first, then the trigger, so the copies are
--    the only writers of the new columns until the trigger takes over.
UPDATE "spideryarn"."article_revisions" SET "reception" = "debate" WHERE "debate" IS NOT NULL;--> statement-breakpoint
UPDATE "spideryarn"."article_revisions" SET "sources_claims" = "debate_claims" WHERE "debate_claims" IS NOT NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "spideryarn"."article_revisions_mirror_renamed"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- One block per renamed column, the new name first. On insert, whichever is
  -- null takes the other (both set: the new one wins); on update, whichever
  -- changed is copied over the other, and the new one wins a tie.
  IF TG_OP = 'INSERT' THEN
    IF NEW."bibliography" IS NOT NULL THEN
      NEW."citations" := NEW."bibliography";
    ELSE
      NEW."bibliography" := NEW."citations";
    END IF;
    IF NEW."reception" IS NOT NULL THEN
      NEW."debate" := NEW."reception";
    ELSE
      NEW."reception" := NEW."debate";
    END IF;
    IF NEW."sources_claims" IS NOT NULL THEN
      NEW."debate_claims" := NEW."sources_claims";
    ELSE
      NEW."sources_claims" := NEW."debate_claims";
    END IF;
  ELSE
    IF NEW."bibliography" IS DISTINCT FROM OLD."bibliography" THEN
      NEW."citations" := NEW."bibliography";
    ELSIF NEW."citations" IS DISTINCT FROM OLD."citations" THEN
      NEW."bibliography" := NEW."citations";
    END IF;
    IF NEW."reception" IS DISTINCT FROM OLD."reception" THEN
      NEW."debate" := NEW."reception";
    ELSIF NEW."debate" IS DISTINCT FROM OLD."debate" THEN
      NEW."reception" := NEW."debate";
    END IF;
    IF NEW."sources_claims" IS DISTINCT FROM OLD."sources_claims" THEN
      NEW."debate_claims" := NEW."sources_claims";
    ELSIF NEW."debate_claims" IS DISTINCT FROM OLD."debate_claims" THEN
      NEW."sources_claims" := NEW."debate_claims";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- `UPDATE OF` all six, so an update that names none of them pays nothing.
DROP TRIGGER IF EXISTS "article_revisions_mirror_renamed" ON "spideryarn"."article_revisions";--> statement-breakpoint
CREATE TRIGGER "article_revisions_mirror_renamed"
  BEFORE INSERT OR UPDATE OF "citations", "bibliography", "debate", "reception", "debate_claims", "sources_claims"
  ON "spideryarn"."article_revisions"
  FOR EACH ROW EXECUTE FUNCTION "spideryarn"."article_revisions_mirror_renamed"();--> statement-breakpoint

-- 2. The step runs. Copied BEFORE the partner function learns the new pairs,
--    so Stage 2's mirror trigger does not also mirror these inserts (it would
--    find the old twin and replace it with itself, which is harmless but is a
--    second writer). `ON CONFLICT DO NOTHING` because nothing wrote the new
--    names before this migration, so a conflict would be news, not something
--    to overwrite.
INSERT INTO "spideryarn"."revision_step_runs"
  ("revision_id", "step_name", "input_hash", "implementation_version", "prompt_version",
   "model", "status", "started_at", "finished_at", "attempt_id")
SELECT "revision_id", 'reception', "input_hash", "implementation_version", "prompt_version",
       "model", "status", "started_at", "finished_at", "attempt_id"
  FROM "spideryarn"."revision_step_runs"
 WHERE "step_name" = 'debate'
ON CONFLICT ("revision_id", "step_name") DO NOTHING;--> statement-breakpoint
INSERT INTO "spideryarn"."revision_step_runs"
  ("revision_id", "step_name", "input_hash", "implementation_version", "prompt_version",
   "model", "status", "started_at", "finished_at", "attempt_id")
SELECT "revision_id", 'sources-claims', "input_hash", "implementation_version", "prompt_version",
       "model", "status", "started_at", "finished_at", "attempt_id"
  FROM "spideryarn"."revision_step_runs"
 WHERE "step_name" = 'debate-claims'
ON CONFLICT ("revision_id", "step_name") DO NOTHING;--> statement-breakpoint

-- Each renamed step name's other spelling, or null: Stage 2's one list of
-- pairs, with Stage 3's added. `revision_step_runs_mirror_renamed` (Stage 2's,
-- unchanged) reads it, so from here on every write on either spelling of
-- either step is mirrored onto the other.
CREATE OR REPLACE FUNCTION "spideryarn"."step_name_partner"("name" text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE "name"
    WHEN 'citations' THEN 'bibliography'
    WHEN 'bibliography' THEN 'citations'
    WHEN 'debate' THEN 'reception'
    WHEN 'reception' THEN 'debate'
    WHEN 'debate-claims' THEN 'sources-claims'
    WHEN 'sources-claims' THEN 'debate-claims'
    ELSE NULL
  END
$$;--> statement-breakpoint

-- **The postcondition**, because a copy that matched nothing and one that
-- worked print the same tick: every old-named run has its twin, every
-- revision's pairs agree, and the old table name still answers.
DO $$
DECLARE missing bigint;
DECLARE unequal bigint;
DECLARE through_view bigint;
DECLARE in_table bigint;
BEGIN
  SELECT count(*) INTO missing
    FROM "spideryarn"."revision_step_runs" o
   WHERE o."step_name" IN ('debate', 'debate-claims', 'citations')
     AND NOT EXISTS (SELECT 1 FROM "spideryarn"."revision_step_runs" n
                      WHERE n."revision_id" = o."revision_id"
                        AND n."step_name" = "spideryarn"."step_name_partner"(o."step_name"));
  SELECT count(*) INTO unequal
    FROM "spideryarn"."article_revisions"
   WHERE "debate" IS DISTINCT FROM "reception"
      OR "debate_claims" IS DISTINCT FROM "sources_claims"
      OR "citations" IS DISTINCT FROM "bibliography";
  SELECT count(*) INTO through_view FROM "spideryarn"."debate_claim_checks";
  SELECT count(*) INTO in_table FROM "spideryarn"."sources_claim_checks";
  IF missing > 0 OR unequal > 0 OR through_view <> in_table THEN
    RAISE EXCEPTION
      'migration reception_expand: % old-named step run(s) without a twin, % revision(s) whose column pairs differ, and % row(s) through the view against % in the table',
      missing, unequal, through_view, in_table;
  END IF;
END $$;
