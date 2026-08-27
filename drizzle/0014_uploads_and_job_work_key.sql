CREATE TABLE "spideryarn"."uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"claimed_bytes" integer NOT NULL,
	"claimed_sha256" text NOT NULL,
	"status" text NOT NULL,
	"minted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grant_expires_at" timestamp with time zone NOT NULL,
	"sha256" text,
	"bytes" integer,
	"reason" text,
	"slug" text,
	CONSTRAINT "uploads_status" CHECK ("spideryarn"."uploads"."status" in ('pending','claimed','verified','rejected','expired')),
	CONSTRAINT "uploads_claimed_bytes" CHECK ("spideryarn"."uploads"."claimed_bytes" > 0 and "spideryarn"."uploads"."claimed_bytes" <= 52428800),
	CONSTRAINT "uploads_claimed_sha256" CHECK ("spideryarn"."uploads"."claimed_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "uploads_sha256" CHECK ("spideryarn"."uploads"."sha256" is null or "spideryarn"."uploads"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "uploads_verified_has_evidence" CHECK ("spideryarn"."uploads"."status" <> 'verified' or ("spideryarn"."uploads"."sha256" is not null and "spideryarn"."uploads"."bytes" is not null)),
	CONSTRAINT "uploads_rejected_has_reason" CHECK ("spideryarn"."uploads"."status" <> 'rejected' or "spideryarn"."uploads"."reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "profile" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "failure_kind" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "upload_filename" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD COLUMN "work_key" text NOT NULL;--> statement-breakpoint
CREATE INDEX "uploads_owner_minted" ON "spideryarn"."uploads" USING btree ("owner_id","minted_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD CONSTRAINT "jobs_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "spideryarn"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_slug" ON "spideryarn"."jobs" USING btree ("owner_id","slug") WHERE "spideryarn"."jobs"."status" in ('queued','running');--> statement-breakpoint
ALTER TABLE "spideryarn"."jobs" ADD CONSTRAINT "jobs_upload_both_or_neither" CHECK (("spideryarn"."jobs"."upload_id" is null) = ("spideryarn"."jobs"."upload_filename" is null));