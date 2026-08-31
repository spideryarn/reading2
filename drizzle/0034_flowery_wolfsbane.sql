ALTER TABLE "spideryarn"."chat_messages" ADD COLUMN "passages" jsonb;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_messages" ADD COLUMN "interrupted" boolean DEFAULT false NOT NULL;