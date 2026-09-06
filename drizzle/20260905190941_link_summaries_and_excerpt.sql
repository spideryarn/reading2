-- The Luna summary's own table, and the one column the summariser reads.
--
-- **`link_summaries` is the owned half of the link card.** `link_previews` is
-- ownerless because it holds what a page says about itself, which is the same
-- for everybody; this row says how that page stands to the piece one particular
-- reader is holding, is written from their own profile, and is shared with
-- nobody. Two tables, deliberately: src/db/schema.ts § `linkSummaries` has the
-- argument, including why the owner is in the primary key here when
-- `glossary_lookups` keeps it beside one.
--
-- The four fingerprints — `dest_hash`, `context_hash`, `profile_hash`,
-- `prompt_version` (and `model`) — are compared on every read, and a mismatch is
-- a miss. Without them `(owner, article, target)` never changes when the article
-- is re-extracted or the reader edits their profile, and both are prompt inputs,
-- so a personalised summary would be stale for ever. GPT Sol, 2026-09-05, P1-3.
--
-- `claim_id` is the single-flight fencing token, exactly as `link_previews` has
-- one and for the same reason — but the stake is higher here: a duplicate
-- preview costs one metadata fetch, a duplicate summary costs a model call.
--
-- **`link_previews.excerpt`** is the opening of Readability's plain text, capped
-- — what the summariser reads and the only column in that table no card ever
-- shows. It is more of exactly what is already there (the page's own public
-- words, under the same expiry and the same sweep), and the alternative was
-- fetching every destination a second time at summary time, which would undo the
-- one thing that table exists for.
--
-- **The two CHECK constraints are dropped and re-added, and both widen.**
-- `link_previews_shape` gains `excerpt` on the side of the union that may not
-- carry content, so a failure row cannot keep the text of a page it never read;
-- `rate_limit_events_bucket` gains `link-summary-fill`, because money and
-- somebody else's bandwidth are different allowances and a reader who has
-- hovered a hundred cold links has done nothing wrong by the first measure.
-- Every existing row passes both.
--
-- docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md
-- § Stage 3. The `auth.users` foreign key on `owner_id` is the next migration,
-- by hand, for the reason src/db/schema.ts's header gives.
CREATE TABLE "spideryarn"."link_summaries" (
	"owner_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"target" text NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"claim_id" uuid,
	"dest_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"profile_hash" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "link_summaries_owner_id_article_id_target_pk" PRIMARY KEY("owner_id","article_id","target"),
	CONSTRAINT "link_summaries_status" CHECK ("spideryarn"."link_summaries"."status" in ('pending','ready')),
	CONSTRAINT "link_summaries_shape" CHECK (case "spideryarn"."link_summaries"."status"
            when 'pending' then "spideryarn"."link_summaries"."summary" is null and "spideryarn"."link_summaries"."claim_id" is not null
            else "spideryarn"."link_summaries"."summary" is not null and "spideryarn"."link_summaries"."claim_id" is null
          end)
);
--> statement-breakpoint
ALTER TABLE "spideryarn"."link_previews" DROP CONSTRAINT "link_previews_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" DROP CONSTRAINT "rate_limit_events_bucket";--> statement-breakpoint
ALTER TABLE "spideryarn"."link_previews" ADD COLUMN "excerpt" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."link_summaries" ADD CONSTRAINT "link_summaries_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "spideryarn"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_summaries_expires_at" ON "spideryarn"."link_summaries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limit_events_bucket_started" ON "spideryarn"."rate_limit_events" USING btree ("bucket","started_at");--> statement-breakpoint
ALTER TABLE "spideryarn"."link_previews" ADD CONSTRAINT "link_previews_shape" CHECK (case "spideryarn"."link_previews"."outcome"
            when 'alias' then "spideryarn"."link_previews"."final_target" is not null and "spideryarn"."link_previews"."failure" is null
                        and "spideryarn"."link_previews"."claim_id" is null
                        and num_nonnulls("spideryarn"."link_previews"."title", "spideryarn"."link_previews"."site_name", "spideryarn"."link_previews"."description", "spideryarn"."link_previews"."first_paragraph", "spideryarn"."link_previews"."words", "spideryarn"."link_previews"."excerpt") = 0
            when 'ok' then "spideryarn"."link_previews"."final_target" is null and "spideryarn"."link_previews"."failure" is null
                        and "spideryarn"."link_previews"."claim_id" is null
                        and num_nonnulls("spideryarn"."link_previews"."title", "spideryarn"."link_previews"."description", "spideryarn"."link_previews"."first_paragraph") > 0
            when 'pending' then "spideryarn"."link_previews"."final_target" is null and "spideryarn"."link_previews"."failure" is null
                        and "spideryarn"."link_previews"."claim_id" is not null
                        and num_nonnulls("spideryarn"."link_previews"."title", "spideryarn"."link_previews"."site_name", "spideryarn"."link_previews"."description", "spideryarn"."link_previews"."first_paragraph", "spideryarn"."link_previews"."words", "spideryarn"."link_previews"."excerpt") = 0
            else "spideryarn"."link_previews"."final_target" is null and "spideryarn"."link_previews"."failure" is not null
                        and "spideryarn"."link_previews"."claim_id" is null
                        and num_nonnulls("spideryarn"."link_previews"."title", "spideryarn"."link_previews"."site_name", "spideryarn"."link_previews"."description", "spideryarn"."link_previews"."first_paragraph", "spideryarn"."link_previews"."words", "spideryarn"."link_previews"."excerpt") = 0
          end);--> statement-breakpoint
ALTER TABLE "spideryarn"."rate_limit_events" ADD CONSTRAINT "rate_limit_events_bucket" CHECK ("spideryarn"."rate_limit_events"."bucket" in ('link-preview-fetch', 'link-summary-fill'));