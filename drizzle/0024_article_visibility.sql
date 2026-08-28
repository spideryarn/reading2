-- May a stranger read this article, and who said so.
--
-- Stage 1 of docs/plans/public-read-only-access.md. Two columns on `articles`
-- and one append-only table, and nothing else changes: no existing read is
-- widened, and the second predicate that uses `visibility` lives in its own
-- file (src/store/public-slug.ts) rather than being bolted onto `ownedSlug`.
--
-- **Fail-closed twice.** `NOT NULL DEFAULT 'private'` means every one of the
-- rows that already exist is private the moment this runs, and the CHECK means
-- a third spelling cannot be stored. The public predicate is
-- `visibility = 'public'`, so even a NULL that got in somehow would not match.
--
-- `visibility` is deliberately not called `published`: `article_revisions.status`
-- already has that value and it means *the pipeline finished*.
--
-- Additive. No drops, no backfill, nothing to guard.
CREATE TABLE "spideryarn"."article_visibility_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"actor_owner_id" uuid NOT NULL,
	"from_visibility" text NOT NULL,
	"to_visibility" text NOT NULL,
	"rights_confirmed" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_visibility_changes_from" CHECK ("spideryarn"."article_visibility_changes"."from_visibility" in ('private','public')),
	CONSTRAINT "article_visibility_changes_to" CHECK ("spideryarn"."article_visibility_changes"."to_visibility" in ('private','public')),
	CONSTRAINT "article_visibility_changes_moved" CHECK ("spideryarn"."article_visibility_changes"."from_visibility" <> "spideryarn"."article_visibility_changes"."to_visibility")
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD COLUMN "public_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spideryarn"."article_visibility_changes" ADD CONSTRAINT "article_visibility_changes_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_visibility_changes_article_at" ON "spideryarn"."article_visibility_changes" USING btree ("article_id","at");--> statement-breakpoint
ALTER TABLE "spideryarn"."articles" ADD CONSTRAINT "articles_visibility" CHECK ("spideryarn"."articles"."visibility" in ('private','public'));