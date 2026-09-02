-- The two tiers we launch with, as data.
--
-- These used to be TypeScript constants. Greg moved them into the database on
-- 2026-09-02 so they can be changed without a deploy — by him, by an agent, or
-- by an admin page later. This migration is the *seed*, not the definition: it
-- is what a fresh database starts with, and after that the rows are the truth.
--
-- WHICH MEANS `npm run db:reset` REVERTS ANY EDITS to these back to what is
-- written here. That is inherent to seeding config in a migration and is worth
-- knowing before somebody spends an afternoon tuning quotas. It is also why the
-- amounts and quotas are duplicated in docs/project/billing.md rather than only
-- living in a row somebody might have changed.
--
-- `stripe_price_id` is deliberately NULL. Nothing here talks to Stripe; a tier
-- with no price cannot be sold and will not match any subscription. Running
-- `npx tsx scripts/stripe-setup.ts --apply` is what creates the Stripe product
-- and price and writes the id back onto the row.
--
-- `on conflict do nothing` so that re-running against a database somebody has
-- already edited leaves their edits alone. A seed should never overwrite.
--
-- The numbers: Reader was 100 ingests until measurement said an article can
-- cost about £1, which made "100 for $10" a £90/month loss per active user.
-- The amounts were chosen at roughly GBP/USD 1.35 and EUR/USD 1.16 and rounded
-- up to whole units — 4-8% above spot on purpose, because Stripe prices are
-- immutable and one set at spot goes underwater on the next move. The ratio is
-- 5x between tiers in every currency. docs/project/billing.md has the whole of
-- the reasoning.

INSERT INTO "spideryarn"."billing_tiers"
  ("id", "product_name", "description", "ingests_per_period", "lookup_key", "sort_order")
VALUES
  ('reader', 'Spideryarn Reader',
   '20 articles a month. Reading what you have already added is always free.',
   20, 'spideryarn_reader_monthly', 10),
  ('researcher', 'Spideryarn Researcher',
   '150 articles a month, for people who read for a living.',
   150, 'spideryarn_researcher_monthly', 20)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "spideryarn"."billing_tier_prices" ("tier_id", "currency", "unit_amount")
VALUES
  ('reader', 'usd', 1000),
  ('reader', 'gbp', 800),
  ('reader', 'eur', 900),
  ('researcher', 'usd', 5000),
  ('researcher', 'gbp', 4000),
  ('researcher', 'eur', 4500)
ON CONFLICT ("tier_id", "currency") DO NOTHING;
