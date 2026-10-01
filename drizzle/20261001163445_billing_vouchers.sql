CREATE TABLE "spideryarn"."billing_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"articles" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "billing_vouchers_email_normalised" CHECK ("spideryarn"."billing_vouchers"."email" = lower(btrim("spideryarn"."billing_vouchers"."email")) and "spideryarn"."billing_vouchers"."email" like '%_@_%'),
	CONSTRAINT "billing_vouchers_articles_range" CHECK ("spideryarn"."billing_vouchers"."articles" between 1 and 1000),
	CONSTRAINT "billing_vouchers_note_length" CHECK ("spideryarn"."billing_vouchers"."note" is null or char_length("spideryarn"."billing_vouchers"."note") <= 500),
	CONSTRAINT "billing_vouchers_claimed_together" CHECK (num_nonnulls("spideryarn"."billing_vouchers"."claimed_by", "spideryarn"."billing_vouchers"."claimed_at") <> 1)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_vouchers" ADD CONSTRAINT "billing_vouchers_claimed_by_billing_accounts_owner_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "spideryarn"."billing_accounts"("owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_vouchers_unclaimed_email" ON "spideryarn"."billing_vouchers" USING btree ("email") WHERE "spideryarn"."billing_vouchers"."claimed_by" is null;--> statement-breakpoint
CREATE INDEX "billing_vouchers_claimed_by" ON "spideryarn"."billing_vouchers" USING btree ("claimed_by");