-- Dismiss keeps the job record: it stamps dismissed_at instead of deleting the
-- row, so the job id a failed import's Report this carries still traces
-- something. Additive and nullable; code that predates it ignores the column.
-- Greg, 2026-10-02 (Q-import-report-details). src/db/schema.ts § jobs.dismissedAt.
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "dismissed_at" timestamp with time zone;
