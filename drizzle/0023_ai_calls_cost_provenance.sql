-- Say where a row's dollar figure came from, and which bill it lands on.
--
-- 0021 built this table on one true premise — every call goes through
-- OpenRouter, and OpenRouter tells us what it charged — and the premise is
-- still true of the *app*. It is not true of `evals/`, which spends real money
-- from a second live credential (`ANTHROPIC_API_KEY`) on calls that deliberately
-- do not use the gateway, because comparing transports is what those evals
-- measure. See docs/plans/ai-spend-outside-the-gateway.md.
--
-- Those calls can be priced — `ANTHROPIC_PRICES` in src/pricing.ts survived the
-- switch to OpenRouter's own number and is still checked against it — but the
-- figure is *our arithmetic*, not a settled charge, and it lands on an account
-- `npm run cost --reconcile` cannot read. Four columns rather than quietly
-- putting an estimate into `credits_used_nanos`, which means one specific thing.
--
-- Additive: no drops, no guard. Existing rows are all OpenRouter, and all of
-- them either carried a provider figure or carried nothing.
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "provider_account" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cost_source" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "computed_cost_nanos" bigint;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "price_version" text;--> statement-breakpoint

-- Backfill from what the existing rows already prove about themselves: they
-- were written by a gateway that only talks to OpenRouter, and `provider` means
-- "OpenRouter answered at all" — a BYOK zero is an answer, not an absence, which
-- is why this tests for NULL rather than for a non-zero number.
UPDATE "spideryarn"."ai_calls"
   SET "provider_account" = 'openrouter',
       "cost_source" = CASE WHEN "credits_used_nanos" IS NULL THEN 'none' ELSE 'provider' END
 WHERE "provider_account" IS NULL;--> statement-breakpoint

-- `NOT NULL` and *no default*, deliberately. A default would make an INSERT that
-- forgot these columns succeed and be wrong, which is the failure this table
-- exists to prevent; without one it fails loudly at the one place that inserts
-- (src/store/ai-calls-pg.ts).
ALTER TABLE "spideryarn"."ai_calls" ALTER COLUMN "provider_account" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ALTER COLUMN "cost_source" SET NOT NULL;--> statement-breakpoint

-- Only three spellings each, and a typo in either is a row that silently drops
-- out of whichever half of the report filters on it.
ALTER TABLE "spideryarn"."ai_calls"
  ADD CONSTRAINT "ai_calls_provider_account_known"
  CHECK ("provider_account" IN ('openrouter', 'anthropic'));--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls"
  ADD CONSTRAINT "ai_calls_cost_source_known"
  CHECK ("cost_source" IN ('provider', 'computed', 'none'));--> statement-breakpoint

-- The two numbers are different claims and exactly one of them can be true of a
-- row: `credits_used_nanos` is what OpenRouter deducted, `computed_cost_nanos`
-- is what we worked out because nobody could be asked. A row carrying both would
-- invite a reader to pick, and a SUM over both would double-count.
ALTER TABLE "spideryarn"."ai_calls"
  ADD CONSTRAINT "ai_calls_one_cost_source"
  CHECK (
    ("cost_source" = 'provider'  AND "credits_used_nanos" IS NOT NULL AND "computed_cost_nanos" IS NULL)
 OR ("cost_source" = 'computed'  AND "credits_used_nanos" IS NULL     AND "computed_cost_nanos" IS NOT NULL)
 OR ("cost_source" = 'none'      AND "credits_used_nanos" IS NULL     AND "computed_cost_nanos" IS NULL)
  );--> statement-breakpoint

-- "What did the product cost, as opposed to the measuring of it" — the split the
-- report leads with, and the one Greg sets a price against.
CREATE INDEX IF NOT EXISTS "ai_calls_scope_started" ON "spideryarn"."ai_calls" ("scope_kind","started_at" DESC);
