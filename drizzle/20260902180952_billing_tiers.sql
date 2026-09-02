CREATE TABLE "spideryarn"."billing_tier_prices" (
	"tier_id" text NOT NULL,
	"currency" text NOT NULL,
	"unit_amount" integer NOT NULL,
	CONSTRAINT "billing_tier_prices_tier_id_currency_pk" PRIMARY KEY("tier_id","currency"),
	CONSTRAINT "billing_tier_prices_amount_positive" CHECK ("spideryarn"."billing_tier_prices"."unit_amount" > 0),
	CONSTRAINT "billing_tier_prices_currency_format" CHECK ("spideryarn"."billing_tier_prices"."currency" ~ '^[a-z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "spideryarn"."billing_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"product_name" text NOT NULL,
	"description" text NOT NULL,
	"ingests_per_period" integer NOT NULL,
	"lookup_key" text NOT NULL,
	"stripe_price_id" text,
	"livemode" boolean,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_tiers_lookup_key" UNIQUE("lookup_key"),
	CONSTRAINT "billing_tiers_price_id" UNIQUE("stripe_price_id"),
	CONSTRAINT "billing_tiers_ingests_positive" CHECK ("spideryarn"."billing_tiers"."ingests_per_period" > 0),
	CONSTRAINT "billing_tiers_id_format" CHECK ("spideryarn"."billing_tiers"."id" ~ '^[a-z][a-z0-9_-]{1,30}$')
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_tier_prices" ADD CONSTRAINT "billing_tier_prices_tier_id_billing_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "spideryarn"."billing_tiers"("id") ON DELETE cascade ON UPDATE no action;