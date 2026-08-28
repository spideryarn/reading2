-- Make the database agree with the filesystem ledger about `price_version`.
--
-- 0023 made the three `cost_source` cases exclusive on the two *money* columns
-- and said nothing about the version stamp. The JSONL reader then grew the
-- stricter rule — a computed figure must say which price row did the arithmetic,
-- and nothing else may carry a stamp — and the two stores were quietly answering
-- different questions about what a valid row is. GPT Sol found the gap.
--
-- The rule is not bookkeeping: a computed figure without a version cannot be
-- re-checked when a rate changes, and that is the only thing separating "our
-- arithmetic" from "a number somebody typed".
--
-- Additive and safe on a populated table: every existing row is `provider` or
-- `none` with a null `price_version`, which is what this requires of them.
ALTER TABLE "spideryarn"."ai_calls"
  ADD CONSTRAINT "ai_calls_price_version_iff_computed"
  CHECK (
    ("cost_source" = 'computed' AND "price_version" IS NOT NULL)
 OR ("cost_source" <> 'computed' AND "price_version" IS NULL)
  );
