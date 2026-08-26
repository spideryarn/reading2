-- A conversation can be about a passage: docs/plans/chat-as-gateway.md.
--
-- Three shapes, and only three. No anchor is an ordinary chat started from the
-- chat panel; a block alone was started from that paragraph's chat button; a
-- block with a quote and an offset was started from a selection in the prose.
-- The two checks below are what stop a fourth — a quote with no offset, which
-- is not an error anybody sees but a mark drawn a few characters to the left of
-- the words it belongs to.
--
-- The foreign key points at the IDENTITY rather than at a revision block, which
-- is the same call `comments_identity_fk` made and the reason a comment
-- survives losing its paragraph. A re-extraction replaces revision blocks;
-- identities are never deleted. So there is deliberately no ON DELETE clause:
-- there is no delete to react to, and a conversation has strictly more to lose
-- than a comment does.
--
-- These constraints are necessary and nowhere near sufficient. A malformed id,
-- an empty quote, an offset past the end of the block, and a quote that is not
-- the text at that offset all pass every one of them. Format and existence are
-- the foreign key's job; the rest is route validation against the rendered
-- block.

ALTER TABLE "spideryarn"."chat_threads" ADD COLUMN "anchor_block_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD COLUMN "anchor_quote" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD COLUMN "anchor_start" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_anchor_identity_fk" FOREIGN KEY ("article_id","anchor_block_id") REFERENCES "spideryarn"."block_identities"("article_id","block_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_anchor_quote_needs_block" CHECK ("spideryarn"."chat_threads"."anchor_quote" is null or "spideryarn"."chat_threads"."anchor_block_id" is not null);--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_anchor_both" CHECK (("spideryarn"."chat_threads"."anchor_quote" is null) = ("spideryarn"."chat_threads"."anchor_start" is null));--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_anchor_start" CHECK ("spideryarn"."chat_threads"."anchor_start" is null or "spideryarn"."chat_threads"."anchor_start" >= 0);