-- `upload_source_guesses.created_at`: when the row was first written. Until now
-- `claimed_at` stood in, and it is the claim's eligibility clock: every reclaim
-- re-stamps it and a release sets it to the Unix epoch.
-- docs/plans/261007c-seventh-sweep-schema-declare-and-enforce-what-the-data-already-satisfies.md § Stage 4
--
-- Hand-split from the one statement drizzle generated, on purpose (the pattern
-- of 20261003170347_store_when_it_happened.sql). `ADD COLUMN … DEFAULT now()`
-- writes the migration's own time into every existing row: an invented time for
-- a claim that happened earlier. Added bare, the existing rows (5 in production
-- on 2026-10-07) stay null, meaning "before we kept this"; the default then
-- applies to rows written from here on. Not backfilled from `claimed_at`, which
-- may be a later claim or the epoch. The snapshot is untouched: nullable,
-- default now().
ALTER TABLE "spideryarn"."upload_source_guesses" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."upload_source_guesses" ALTER COLUMN "created_at" SET DEFAULT now();
