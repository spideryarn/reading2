CREATE TABLE "spideryarn"."author_gift_guidance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guidance" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "author_gift_guidance_length" CHECK ("spideryarn"."author_gift_guidance"."guidance" is null or char_length("spideryarn"."author_gift_guidance"."guidance") between 1 and 100000)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."author_lookups" DROP CONSTRAINT "author_lookups_text_lengths";--> statement-breakpoint
ALTER TABLE "spideryarn"."author_lookups" ADD COLUMN "suggested_message" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."author_lookups" ADD COLUMN "guidance_id" uuid;--> statement-breakpoint
CREATE INDEX "author_gift_guidance_newest" ON "spideryarn"."author_gift_guidance" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "spideryarn"."author_lookups" ADD CONSTRAINT "author_lookups_guidance_id_author_gift_guidance_id_fk" FOREIGN KEY ("guidance_id") REFERENCES "spideryarn"."author_gift_guidance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."author_lookups" ADD CONSTRAINT "author_lookups_text_lengths" CHECK (coalesce(char_length("spideryarn"."author_lookups"."failure"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."author_name"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."author_source_url"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."email"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."email_source_url"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."suggested_email"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."contact_url"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."model"), 0) <= 10000
          and coalesce(char_length("spideryarn"."author_lookups"."suggested_message"), 0) <= 10000);