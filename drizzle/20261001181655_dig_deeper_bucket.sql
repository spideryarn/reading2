-- *Dig deeper* — docs/plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md.
--
-- Additive: a widened CHECK on `rate_limit_events.bucket` for the new `dig-deeper`
-- allowance (src/dig-deeper.ts § DIG_DEEPER_RATE_POLICY). Every existing row
-- satisfies the wider set.
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill', 'citation-find', 'shelf-topics', 'upload-source-guess', 'citation-investigate', 'dig-deeper'));