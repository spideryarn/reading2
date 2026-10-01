CREATE TABLE "spideryarn"."billing_voucher_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempt_started_at" timestamp with time zone,
	"detail" text,
	"recipient" text,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"body_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_voucher_emails_kind" CHECK ("spideryarn"."billing_voucher_emails"."kind" in ('gift', 'claimed')),
	CONSTRAINT "billing_voucher_emails_status" CHECK ("spideryarn"."billing_voucher_emails"."status" in ('queued', 'sending', 'sent', 'skipped', 'failed')),
	CONSTRAINT "billing_voucher_emails_attempts" CHECK ("spideryarn"."billing_voucher_emails"."attempts" >= 0),
	CONSTRAINT "billing_voucher_emails_detail_length" CHECK ("spideryarn"."billing_voucher_emails"."detail" is null or char_length("spideryarn"."billing_voucher_emails"."detail") <= 200),
	CONSTRAINT "billing_voucher_emails_gift_has_recipient" CHECK ("spideryarn"."billing_voucher_emails"."kind" <> 'gift' or "spideryarn"."billing_voucher_emails"."recipient" is not null),
	CONSTRAINT "billing_voucher_emails_sending_has_lease" CHECK ("spideryarn"."billing_voucher_emails"."status" <> 'sending' or "spideryarn"."billing_voucher_emails"."attempt_started_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_voucher_emails" ADD CONSTRAINT "billing_voucher_emails_voucher_id_billing_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "spideryarn"."billing_vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_voucher_emails_voucher" ON "spideryarn"."billing_voucher_emails" USING btree ("voucher_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_voucher_emails_one_claimed" ON "spideryarn"."billing_voucher_emails" USING btree ("voucher_id") WHERE "spideryarn"."billing_voucher_emails"."kind" = 'claimed';