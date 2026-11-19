-- The sources digest and a summary level become thread origins: plan 261030b § The ask box
-- (docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md, Stage 3).
-- The origin-mode CHECK admits 'sources-digest'; the item-shape CHECK makes both carry an id and a snapshot,
-- like a glossary entry; and each gets a CHECK on its id's form (SOURCES_DIGEST_ITEM_ID and SUMMARY_ITEM_ID in
-- src/types.ts). 'summary' was reserved with no shape until now (plan 261009k, F8), and the old
-- chat_threads_origin_summary refused every shape column; this one requires its id instead. The route never
-- accepted that reserved shape, but the old database contract did. Preserve any such conversation as an
-- ordinary no-origin chat before `summary` comes to mean a shaped origin, so adding the new CHECK cannot fail
-- on a row the previous schema admitted.
UPDATE "spideryarn"."chat_threads" SET "origin_mode" = null WHERE "origin_mode" = 'summary';--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" DROP CONSTRAINT "chat_threads_origin_mode";--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" DROP CONSTRAINT "chat_threads_origin_item";--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" DROP CONSTRAINT "chat_threads_origin_summary";--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_origin_sources_digest" CHECK ("spideryarn"."chat_threads"."origin_mode" is distinct from 'sources-digest' or "spideryarn"."chat_threads"."origin_item_id" ~ '^sd-[0-9]{14,17}(-p[1-9][0-9]{0,2})?$');--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_origin_mode" CHECK ("spideryarn"."chat_threads"."origin_mode" is null or "spideryarn"."chat_threads"."origin_mode" in ('debate','reception','sources-claims','summary','glossary','citations','bibliography','ideas','quiz','cite-check','situate','sources-digest'));--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_origin_item" CHECK ("spideryarn"."chat_threads"."origin_mode" is null or "spideryarn"."chat_threads"."origin_mode" not in ('glossary','citations','bibliography','ideas','situate','sources-digest','summary') or ("spideryarn"."chat_threads"."origin_item_id" is not null and "spideryarn"."chat_threads"."origin_quote" is not null and "spideryarn"."chat_threads"."origin_block_id" is null and "spideryarn"."chat_threads"."origin_lens" is null));--> statement-breakpoint
ALTER TABLE "spideryarn"."chat_threads" ADD CONSTRAINT "chat_threads_origin_summary" CHECK ("spideryarn"."chat_threads"."origin_mode" is distinct from 'summary' or "spideryarn"."chat_threads"."origin_item_id" ~ '^ss-(brief|fuller)-[0-9]{14,17}$');
