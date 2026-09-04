ALTER TABLE "spideryarn"."billing_accounts" ADD COLUMN "cancel_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_accounts" ADD COLUMN "quota_limit_delta" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_accounts" ADD COLUMN "quota_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_accounts" ADD CONSTRAINT "billing_accounts_quota_delta_is_dated" CHECK (num_nonnulls("spideryarn"."billing_accounts"."quota_limit_delta", "spideryarn"."billing_accounts"."quota_period_start") <> 1);