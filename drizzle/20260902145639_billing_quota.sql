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
	CONSTRAINT "ingest_events_settled_once" CHECK (num_nonnulls("spideryarn"."ingest_events"."succeeded_at", "spideryarn"."ingest_events"."released_at") <= 1),
	CONSTRAINT "ingest_events_settled_after_reserved" CHECK (("spideryarn"."ingest_events"."succeeded_at" is null or "spideryarn"."ingest_events"."succeeded_at" >= "spideryarn"."ingest_events"."reserved_at")
          and ("spideryarn"."ingest_events"."released_at" is null or "spideryarn"."ingest_events"."released_at" >= "spideryarn"."ingest_events"."reserved_at"))
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "ingest_event_id" uuid;--> statement-breakpoint
CREATE INDEX "ingest_events_owner_reserved" ON "spideryarn"."ingest_events" USING btree ("owner_id","reserved_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_ingest_event_unique" ON "spideryarn"."jobs" USING btree ("ingest_event_id") WHERE "spideryarn"."jobs"."ingest_event_id" is not null;