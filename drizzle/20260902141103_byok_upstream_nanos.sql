-- Put the double-count trap out of reach of the obvious SQL.
--
-- `upstream_inference_nanos` was added by 0021 to hold what a BYOK call's
-- inference was worth: under BYOK OpenRouter's own charge is legitimately `0`
-- because somebody else's key was billed, so without this column that call
-- contributes nothing to a total and the total reads correct while missing real
-- money.
--
-- **But it was written on every chat-wire call, not only the BYOK ones.**
-- OpenRouter reports `cost_details.upstream_inference_cost` on an ordinary call
-- too, equal to `cost` to seven decimal places (measured 2026-08-27) — the same
-- money, reported twice. So the column held a duplicate of `credits_used_nanos`
-- on every non-BYOK row, and
--
--     SUM(credits_used_nanos) + SUM(upstream_inference_nanos)
--
-- was twice the truth. 0023 anticipated exactly this class for the other pair of
-- money columns and said so — *"a SUM over both would double-count"* — and this
-- column sat outside that constraint. The only expression that got it right
-- lived in TypeScript, in `totalRows()` (src/store/ai-calls.ts). An auditor
-- writing the natural SQL against this table got $23.54 where the truth was
-- $11.77; on this laptop's ledger on 2026-09-02 it was $5.03 against $2.54.
--
-- The next thing anybody writes against this table is a per-owner-per-month
-- aggregate in SQL, for Stripe. It should not have to know a rule that is not in
-- the schema, and it will not be reviewed by anybody who does.
--
-- ## What this does, and in this order
--
-- 1. **Rename**, so the name carries the condition. GPT Sol kept this over the
--    cheaper "stop writing it and leave the name": `upstream_inference_nanos`
--    *"preserves the exact ambiguity that caused the defect"*, and this is the
--    least expensive moment to change it — before the Stripe work depends on the
--    schema.
-- 2. **Backfill**, nulling every value that is not the BYOK pocket. This has to
--    come before the constraint or `ADD CONSTRAINT` fails on the existing rows,
--    and it is a *deletion of a duplicate*, not of a fact: on those rows the
--    same number is still in `credits_used_nanos`, which is the settled figure
--    `npm run cost --reconcile` compares against OpenRouter's own running total.
-- 3. **CHECK**, so the invariant is the database's rather than a convention.
--
-- ## `is_byok IS TRUE`, not `is_byok`
--
-- The column is nullable — `boolean | null` — because "the provider did not say"
-- is a real state and is not "no". A PostgreSQL CHECK passes on `UNKNOWN`, so a
-- bare `is_byok` would let a row with a NULL flag carry an upstream figure
-- through the very constraint written to stop it. GPT Sol wrote the SQL for this
-- reason.
--
-- ## Deployability, stated rather than claimed
--
-- Migrations run before code deploys, so a direct rename briefly leaves the old
-- code facing the new schema. Expand/contract would close that window. For this
-- alpha we take the coordinated rename knowingly — recorded as a choice, not
-- presented as unqualified deployability. GPT Sol's review, 2026-09-02.
--
-- The filesystem ledger is append-only and cannot be migrated: its old lines are
-- translated on read instead, by `translateByokUpstream` in
-- src/store/ai-calls-fs.ts, under exactly the same condition as the UPDATE
-- below. And the cutoff for pricing is decided: **Postgres is authoritative from
-- this migration's deploy, and the filesystem history is not imported** — it is
-- development evidence and contains no complete ingest.
--
-- docs/plans/260902g-cost-tracking-that-can-set-a-price.md, stage 1b.
ALTER TABLE "spideryarn"."ai_calls" RENAME COLUMN "upstream_inference_nanos" TO "byok_upstream_nanos";--> statement-breakpoint

-- Every value that was never the BYOK pocket. `NOT (…)` rather than three
-- separate `OR`s so this and the CHECK below cannot drift into disagreeing about
-- what a BYOK row is; the two are the same predicate, negated.
UPDATE "spideryarn"."ai_calls"
   SET "byok_upstream_nanos" = NULL
 WHERE "byok_upstream_nanos" IS NOT NULL
   AND NOT (
     "cost_source" = 'provider'
     AND "is_byok" IS TRUE
     AND "provider_account" = 'openrouter'
   );--> statement-breakpoint

-- The credits/computed exclusivity CHECK from 0023 stays exactly as it is. This
-- one governs only the BYOK pocket, and between them
--
--     COALESCE(credits_used_nanos,0)
--   + COALESCE(byok_upstream_nanos,0)
--   + COALESCE(computed_cost_nanos,0)
--
-- is now the correct total on every row — which is the whole point of the
-- exercise. tests/store-ai-calls.test.ts holds that sum against `totalRows()`
-- over provider, BYOK, computed and unpriced rows, so the day the two stop
-- agreeing something goes red.
ALTER TABLE "spideryarn"."ai_calls"
  ADD CONSTRAINT "ai_calls_byok_upstream_only"
  CHECK (
    "byok_upstream_nanos" IS NULL
    OR (
      "cost_source" = 'provider'
      AND "is_byok" IS TRUE
      AND "provider_account" = 'openrouter'
    )
  );
