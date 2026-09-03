-- Take the allowance back out of the tier descriptions.
--
-- `/profile` renders `ingests_per_period` structurally and puts the description
-- beside it, so a description that opens by restating the number is a second
-- copy of it. On screen that reads:
--
--   Spideryarn Reader · €9 · £8 · $10 a month — 20 articles a month. 20
--   articles a month. Reading what you have already added is always free.
--
-- Found by driving a real Checkout in the browser on 2026-09-03; every unit
-- test passed throughout, because none of them renders the two together.
--
-- docs/project/billing.md § Adding a tier or a currency already called this
-- out and asked whoever next edited these rows to take the first sentence out.
-- The reason it matters beyond the repetition: raising a quota is meant to be
-- one UPDATE to `ingests_per_period`, and a description carrying the old number
-- would go on saying 20 after the allowance became 50.
--
-- Written as a migration rather than a bare UPDATE so that a fresh database and
-- an existing one converge — the seed in 20260902181004 still writes the old
-- text, and editing an applied migration would change its checksum.
--
-- Matched on the exact old text so this cannot quietly clobber a description
-- somebody has since rewritten by hand.

UPDATE "spideryarn"."billing_tiers"
   SET "description" = 'Reading what you have already added is always free.'
 WHERE "id" = 'reader'
   AND "description" = '20 articles a month. Reading what you have already added is always free.';
--> statement-breakpoint
UPDATE "spideryarn"."billing_tiers"
   SET "description" = 'For people who read for a living.'
 WHERE "id" = 'researcher'
   AND "description" = '150 articles a month, for people who read for a living.';
