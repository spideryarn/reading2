-- Debate's reader-picked claim checks get their own allowance —
-- docs/plans/261008i-debate-claims-picked-by-the-reader.md § 3, GPT Sol's E1.
--
-- Additive: a widened CHECK on `rate_limit_events.bucket` for the new
-- `debate-check` bucket (src/debate.ts § DEBATE_CHECK_RATE_POLICY). Every
-- existing row satisfies the wider set.
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics', 'upload-source-guess', 'citation-investigate', 'dig-deeper', 'feedback-notice', 'help-chat', 'debate-check'));