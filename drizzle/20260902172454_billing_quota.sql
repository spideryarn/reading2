-- The billing quota tables.
--
-- **HAND-TRIMMED, and this comment is the reason.** `drizzle-kit generate`
-- produced this file with a dozen extra statements in it — `reserves_name`,
-- `url_key`, five `jobs_*` indexes, `DROP INDEX jobs_active_slug`, a feedback
-- CHECK — all of which belong to migrations that have ALREADY RUN (0052, the
-- two feedback ones, realtime). Applying it as generated would have failed on
-- `already exists`, or worse, dropped a live index.
--
-- Why it did that: the three snapshots that follow `0052_snapshot.json` in the
-- chain — realtime, feedback_body_and_kind, feedback_one_body — do not contain
-- `reserves_name`. They were generated from a `src/db/schema.ts` that predated
-- 0052, so the newest snapshot describes a schema without it, and drizzle
-- diffed this migration against that. `npm run db:chain` is GREEN on this,
-- because it checks `prevId` linkage and not contents — which is precisely the
-- "hole or broken link" case docs/project/database.md § Two worktrees generated
-- at once warns is worse than a fork: *"it does not refuse at all — it diffs
-- against the wrong snapshot and writes SQL that looks complete and re-emits
-- DDL that has already run."*
--
-- What is kept is exactly this change and nothing else. The **snapshot** beside
-- this file is left as generated and is correct: it describes the real current
-- schema, columns from 0052 included, so the chain's contents are truthful from
-- here on and the next `generate` diffs against something real.

CREATE TABLE "spideryarn"."billing_accounts" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"price_id" text,
	"status" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"livemode" boolean,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "billing_accounts_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "billing_accounts_period_order" CHECK ("spideryarn"."billing_accounts"."current_period_start" is null or "spideryarn"."billing_accounts"."current_period_end" is null or "spideryarn"."billing_accounts"."current_period_start" < "spideryarn"."billing_accounts"."current_period_end"),
	CONSTRAINT "billing_accounts_subscription_needs_customer" CHECK ("spideryarn"."billing_accounts"."stripe_subscription_id" is null or "spideryarn"."billing_accounts"."stripe_customer_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."ingest_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"slug" text,
	CONSTRAINT "ingest_events_id_owner" UNIQUE("id","owner_id"),
	CONSTRAINT "ingest_events_settled_once" CHECK (num_nonnulls("spideryarn"."ingest_events"."succeeded_at", "spideryarn"."ingest_events"."released_at") <= 1),
	CONSTRAINT "ingest_events_settled_after_reserved" CHECK (("spideryarn"."ingest_events"."succeeded_at" is null or "spideryarn"."ingest_events"."succeeded_at" >= "spideryarn"."ingest_events"."reserved_at")
          and ("spideryarn"."ingest_events"."released_at" is null or "spideryarn"."ingest_events"."released_at" >= "spideryarn"."ingest_events"."reserved_at"))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "ingest_event_id" uuid;--> statement-breakpoint
CREATE INDEX "ingest_events_owner_reserved" ON "spideryarn"."ingest_events" USING btree ("owner_id","reserved_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_ingest_event_unique" ON "spideryarn"."jobs" USING btree ("ingest_event_id") WHERE "spideryarn"."jobs"."ingest_event_id" is not null;
