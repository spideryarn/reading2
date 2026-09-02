-- The per-article queue: one index becomes four, plus the two columns they need.
--
-- docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 1a-1e.
--
-- THIS MIGRATION REFUSES TO RUN WHILE ANY JOB IS QUEUED OR RUNNING, and that is
-- the whole of how `reserves_name` and `url_key` get a meaning for rows that
-- predate them. The alternative is to guess which historical rows minted their
-- slug, from `url` or `upload` or the shape of the slug string — and guessing is
-- the failure mode this repository keeps writing up. Drain instead: every
-- surviving row is then terminal, so all four predicates below exclude it and
-- the columns' values are irrelevant rather than invented.
--
-- On a one-reader alpha with three concurrent slots that is a wait of minutes.
-- To clear it: let the jobs finish, or press Stop on the cards, or delete the
-- rows. The DETAIL below names them.
--
-- The second check is for active rows on ONE slug belonging to TWO owners.
-- `jobs_one_running_per_slug` is global on `slug` — `articles.slug` is the URL
-- contract and is globally unique — so such a pair could not be indexed. It is
-- reported separately because `CREATE UNIQUE INDEX` would otherwise fail with a
-- duplicate-key error naming two ids and no reason, and the fix is different:
-- one of those two owners is building toward a name that is not theirs.
DO $$
DECLARE
  active_rows text;
  shared_slugs text;
  stray_cancelling text;
BEGIN
  SELECT string_agg(format('%s (%s, %s, owner %s)', id, slug, status, owner_id), E'\n  '
                    ORDER BY created_at, id)
    INTO active_rows
    FROM "spideryarn"."jobs"
   WHERE status IN ('queued', 'running');

  SELECT string_agg(line, E'\n  ')
    INTO shared_slugs
    FROM (
      SELECT format('%s: %s owners', slug, count(DISTINCT owner_id)) AS line
        FROM "spideryarn"."jobs"
       WHERE status IN ('queued', 'running')
       GROUP BY slug
      HAVING count(DISTINCT owner_id) > 1
    ) AS clashes;

  IF shared_slugs IS NOT NULL THEN
    RAISE EXCEPTION
      'jobs_one_running_per_slug is global on slug, and these slugs have active jobs under more than one owner'
      USING DETAIL = '  ' || shared_slugs,
            HINT = 'Settle or delete one owner''s jobs on each of those slugs, then migrate again.';
  END IF;

  IF active_rows IS NOT NULL THEN
    RAISE EXCEPTION
      'this migration will not run while any job is queued or running — drain the queue first'
      USING DETAIL = '  ' || active_rows,
            HINT = 'Let them finish, press Stop on their cards, or delete the rows; then migrate again.';
  END IF;

  -- A terminal row carrying `cancelling` is corrupt: every transition out of
  -- `running` clears the flag. Said here rather than left to fail on the CHECK
  -- at the foot of this file, which would name the constraint and not the row.
  SELECT string_agg(id, ', ' ORDER BY id)
    INTO stray_cancelling
    FROM "spideryarn"."jobs"
   WHERE cancelling AND status <> 'running';

  IF stray_cancelling IS NOT NULL THEN
    RAISE EXCEPTION
      'jobs_cancelling_is_running: these finished jobs still carry the cancelling flag'
      USING DETAIL = '  ' || stray_cancelling,
            HINT = 'Clear it — `update spideryarn.jobs set cancelling = false where status <> ''running''` — then migrate again.';
  END IF;
END
$$;--> statement-breakpoint
DROP INDEX "spideryarn"."jobs_active_slug";--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "reserves_name" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "url_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_running_per_slug" ON "spideryarn"."jobs" USING btree ("slug") WHERE "spideryarn"."jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_reserved_slug" ON "spideryarn"."jobs" USING btree ("slug") WHERE "spideryarn"."jobs"."status" in ('queued','running') and "spideryarn"."jobs"."reserves_name";--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_work" ON "spideryarn"."jobs" USING btree ("owner_id","slug","work_key") WHERE "spideryarn"."jobs"."status" in ('queued','running') and not "spideryarn"."jobs"."cancelling";--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_source" ON "spideryarn"."jobs" USING btree ("owner_id","url_key") WHERE "spideryarn"."jobs"."status" in ('queued','running') and "spideryarn"."jobs"."reserves_name";--> statement-breakpoint
CREATE INDEX "jobs_slug_order" ON "spideryarn"."jobs" USING btree ("slug","created_at","id") WHERE "spideryarn"."jobs"."status" in ('queued','running');--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD CONSTRAINT "jobs_cancelling_is_running" CHECK (not "spideryarn"."jobs"."cancelling" or "spideryarn"."jobs"."status" = 'running');
