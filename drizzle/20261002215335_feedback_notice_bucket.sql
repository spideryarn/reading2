-- The admin's mail about a reader's feedback — docs/plans/261002j-email-the-admin-each-reader-s-feedback.md.
--
-- Additive: a widened CHECK on `rate_limit_events.bucket` for the new `feedback-notice`
-- allowance (src/feedback-notice.ts § FEEDBACK_NOTICE_POLICY). Every existing row
-- satisfies the wider set.
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics', 'upload-source-guess', 'citation-investigate', 'dig-deeper', 'feedback-notice'));