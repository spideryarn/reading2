ALTER TABLE "spideryarn"."comments" ALTER COLUMN "quote" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ALTER COLUMN "start" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_anchor_pair" CHECK (("spideryarn"."comments"."quote" is null) = ("spideryarn"."comments"."start" is null));--> statement-breakpoint
ALTER TABLE "spideryarn"."comments" ADD CONSTRAINT "comments_whole_block_is_free" CHECK ("spideryarn"."comments"."quote" is not null or "spideryarn"."comments"."status" = 'none');