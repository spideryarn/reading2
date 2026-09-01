-- `mirrored_at` used to mean two things and could only be one of them.
--
-- src/feedback.ts called `captureFeedback`, got an event id back synchronously
-- and wrote `mirrored_at` at once. But the SDK sends asynchronously,
-- `Client.sendEvent` does not return the send promise, and `sendEnvelope`
-- catches every transport failure and resolves an empty result — so a network
-- failure, a rate limit, a dropped event or a disabled transport all left a row
-- claiming Sentry had taken a report that never arrived. GPT Sol's code review,
-- 2026-08-31, and exactly the shape docs/reusable/silent-success.md is about,
-- in the one column we would use to find a stranded report.
--
-- So the two facts get two columns:
--
--   mirror_attempted_at  we handed it over          (what we know at that moment)
--   mirrored_at          Sentry acknowledged it     (a 2xx from the transport)
--
-- and `mirror_attempted_at is not null and mirrored_at is null` becomes the
-- trustworthy query for a report that went nowhere.
ALTER TABLE "spideryarn"."feedback" ADD COLUMN "mirror_attempted_at" timestamp with time zone;--> statement-breakpoint
-- Backfill before the constraint, not after. A row written under the old
-- meaning was at least *attempted* at that time, which is the honest reading of
-- what the old column recorded — and without this the CHECK below refuses to
-- validate against rows that already exist.
UPDATE "spideryarn"."feedback" SET "mirror_attempted_at" = "mirrored_at" WHERE "mirrored_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_mirror_attempted_first" CHECK ("spideryarn"."feedback"."mirrored_at" is null or "spideryarn"."feedback"."mirror_attempted_at" is not null);
