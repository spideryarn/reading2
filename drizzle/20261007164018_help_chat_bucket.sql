-- Ask about Spideryarn, the Help pages' chatbot — docs/plans/261007k-help-chatbot.md.
--
-- Additive: a widened CHECK on `rate_limit_events.bucket` for the new `help-chat`
-- allowance (src/help-chat-call.ts § HELP_CHAT_RATE_POLICY). Every existing row
-- satisfies the wider set.
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics', 'upload-source-guess', 'citation-investigate', 'dig-deeper', 'feedback-notice', 'help-chat'));