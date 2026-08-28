ALTER TABLE "spideryarn"."revision_blocks" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_blocks" ADD COLUMN "treatment" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_blocks" ADD COLUMN "note_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_role" CHECK ("spideryarn"."revision_blocks"."role" is null or "spideryarn"."revision_blocks"."role" in ('footnote','reference','acknowledgment','credit','appendix'));--> statement-breakpoint
ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_treatment" CHECK ("spideryarn"."revision_blocks"."treatment" is null or "spideryarn"."revision_blocks"."treatment" in ('supplement'));