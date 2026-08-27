-- Reshape `ai_calls` into the ledger that `src/ai-spend.ts` actually writes.
--
-- The table has existed since 0000 and nothing has ever inserted into it: its
-- columns were designed for two vendors and for costs we would compute
-- ourselves, and both of those stopped being true on 2026-08-27 when every call
-- started going through OpenRouter and carrying its own figure.
--
-- Altered rather than dropped and recreated, so that a database which somehow
-- does hold rows keeps them rather than losing them to a convenience. The guard
-- below is the other half of that: reading the source and concluding the table
-- is empty is not the same as the table being empty.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "spideryarn"."ai_calls" LIMIT 1) THEN
    RAISE EXCEPTION
      'ai_calls is not empty. This migration drops columns (provider, cost_micros, raw_response, ...) that were never written by any released code. Migrate the rows by hand, or empty the table deliberately, before running it.';
  END IF;
END $$;--> statement-breakpoint

-- The old shape. `cost_micros` in particular had to go: a query embedding costs
-- about $0.0000006, which is less than one micro-dollar and rounded to zero, so
-- the row read as free. `raw_response` had to go for a different reason — it
-- would have held model output derived from the reader's article.
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "revision_id";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "model";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "prompt_tokens";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "completion_tokens";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "cost_micros";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "latency_ms";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "finish_reason";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "raw_response";--> statement-breakpoint

-- The id is minted before the request goes out, so that a call which never comes
-- back still has a name. A default would hide a caller that forgot to supply one.
ALTER TABLE "spideryarn"."ai_calls" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "run_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "generation_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "scope_kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "article_slug" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "step_name" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "wire" text NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "requested_model" text NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "answered_model" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "upstream" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "credential_fingerprint" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "started_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "finished_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "duration_ms" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "outcome" text NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "credits_used_nanos" bigint;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "upstream_inference_nanos" bigint;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "is_byok" boolean;--> statement-breakpoint
-- `reported_`, not `input_tokens`: the Messages wire reports cache reads and
-- writes outside the input count and the chat wire reports them inside it, so a
-- column with the plain name invites a sum across both that counts nothing.
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "reported_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cache_write_5m_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cache_write_1h_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "web_searches" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "service_tier" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "inference_geo" text;--> statement-breakpoint

-- `RESTRICT`, following the rule 0001 set for every other owner FK: deleting an
-- account must not silently delete the data. A billing history is the last thing
-- that should vanish on a cascade — and the day somebody genuinely wants to
-- delete an account while keeping its spend, the answer is a billing-account row
-- that outlives `auth.users`, not a weaker constraint here.
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_owner_id_users_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- What a spend limit would have to ask, and the one query `endJob` makes.
CREATE INDEX IF NOT EXISTS "ai_calls_owner_started"
  ON "spideryarn"."ai_calls" ("owner_id", "started_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_calls_job" ON "spideryarn"."ai_calls" ("job_id");
