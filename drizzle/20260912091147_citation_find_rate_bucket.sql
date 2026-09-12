-- `rate_limit_events_bucket` gains `citation-find`: Citations mode's *Find it*
-- is a billed web search per press, and GPT Sol's owed code review (F11,
-- docs/plans/260911g-citations-mode-code-review-sol.md) found nothing bounded
-- how many an owner could make. src/citation-find.ts § `FIND_RATE_POLICY`.
--
-- Widening only: every existing bucket stays in the set, so no row can fail the
-- new constraint. The CHECK is hand-kept in src/db/schema.ts.
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find'));