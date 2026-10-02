CREATE TABLE "spideryarn"."feedback_shipped_emails" (
	"owner_id" uuid NOT NULL,
	"report_id" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_shipped_emails_owner_id_report_id_pk" PRIMARY KEY("owner_id","report_id"),
	CONSTRAINT "feedback_shipped_emails_status" CHECK ("spideryarn"."feedback_shipped_emails"."status" in ('sending', 'sent', 'failed')),
	CONSTRAINT "feedback_shipped_emails_attempts" CHECK ("spideryarn"."feedback_shipped_emails"."attempts" >= 1),
	CONSTRAINT "feedback_shipped_emails_detail_length" CHECK ("spideryarn"."feedback_shipped_emails"."detail" is null or char_length("spideryarn"."feedback_shipped_emails"."detail") <= 200)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_shipped_emails" ADD CONSTRAINT "feedback_shipped_emails_feedback_fk" FOREIGN KEY ("owner_id","report_id") REFERENCES "spideryarn"."feedback"("owner_id","id") ON DELETE cascade ON UPDATE no action;